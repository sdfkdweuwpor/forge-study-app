/**
 * Schema v2 upgrade (PLAN §4.6): a v1 database seeded with the WGU sample (as v1 rows) opens as v2 with
 * the mapped values, the upgrade is idempotent, the settings defaults fill in, trashed rows come back as
 * v2 rows, and a v1 backup migrates to exactly what the upgraded database holds.
 */
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { buildStarterData } from '@/data/sample/starterTasks'
import { buildWguBsCs, COURSE_IDS, WGU_GOAL_ID } from '@/data/sample/wguBsCs'
import { ForgeDB } from '@/db/db'
import { upgradeV2 } from '@/db/migrations/v2'
import { STORES_V1, TABLE_NAMES } from '@/db/schema'
import { defaultSettings } from '@/db/defaults'
import type { Flashcard, Goal, Milestone, Task, TrashItem, Unit } from '@/db/types'
import { migrateBackupV1toV2 } from '@/logic/backup'
import { atTime } from '@/logic/dates'
import { goalToV2, taskToV2, unitToV2 } from '@/logic/schemaV2'

const TODAY = '2026-09-29'
const NOW = atTime(TODAY, '09:30')
const UPGRADE_AT = NOW + 60_000

type Row = Record<string, unknown>

/** A current row as schema v1 stored it (the test builds v1 data from today's sample). */
function v1Task(t: Task): Row {
  const {
    doDate,
    doTime,
    durationMinutes: _d,
    autoSlot: _a,
    kind: _k,
    assessmentId: _as,
    sync: _s,
    ...rest
  } = t
  // v1 had one date, meaning "the day to do it".
  return { ...rest, dueDate: doDate ?? t.dueDate, dueTime: doTime ?? t.dueTime }
}
function v1Goal(g: Goal): Row {
  const { planning: _p, ...rest } = g
  return rest
}
function v1Milestone(m: Milestone): Row {
  const { selfRating: _s, ...rest } = m
  return rest
}
function v1Unit(u: Unit): Row {
  const { selfRating: _s, estimateSource: _e, baseEstimateMinutes: _b, optional: _o, ...rest } = u
  return rest
}

const flashcardV1: Row = {
  id: 'card-1',
  createdAt: 100,
  updatedAt: 200,
  goalId: WGU_GOAL_ID,
  milestoneId: COURSE_IDS.C779,
  front: 'What does `display: grid` do?',
  back: 'Makes the element a grid container.',
  tags: [],
  ease: 2.5,
  intervalDays: 3,
  repetitions: 2,
  lapses: 0,
  dueDate: '2026-10-01',
  lastReviewedAt: 150,
  suspended: false,
} satisfies Omit<Flashcard, 'scheduler' | 'fsrs' | 'noteRef'>

/** Every v1 table, seeded: the WGU sample, its tasks, a flashcard, settings and a trashed task. */
function v1Tables(): Record<string, Row[]> {
  const { goal, milestones, units } = buildWguBsCs(TODAY, NOW)
  const { tasks } = buildStarterData({ today: TODAY, now: NOW })
  const settings = defaultSettings(NOW) as unknown as Row
  const scheduling = { ...(settings.scheduling as Row) }
  delete scheduling.taskWindows
  scheduling.defaultStudyStart = '07:30'
  const trashed = tasks.find((t) => t.id === 'task-library-card') as Task
  const trash: TrashItem = {
    id: 'trash-1',
    createdAt: NOW,
    updatedAt: NOW,
    entityTable: 'tasks',
    entityId: 'task-old',
    title: 'Old errand',
    expiresAt: NOW + 1_000_000,
    payload: { tasks: [{ ...v1Task(trashed), id: 'task-old', title: 'Old errand' }] },
  }
  const noTarget = { ...v1Goal(goal), id: 'goal-no-target', targetDate: null, order: 1 }
  return {
    settings: [{ ...settings, scheduling }],
    goals: [v1Goal(goal), noTarget],
    milestones: milestones.map(v1Milestone),
    units: units.map(v1Unit),
    tasks: tasks.map(v1Task),
    flashcards: [flashcardV1],
    trash: [trash as unknown as Row],
  }
}

let name = ''
let upgraded: ForgeDB | null = null

afterEach(async () => {
  upgraded?.close()
  await Dexie.delete(name)
  upgraded = null
})

async function openUpgraded(): Promise<ForgeDB> {
  name = `forge-migration-v2-${Math.random().toString(36).slice(2)}`
  const v1 = new Dexie(name)
  v1.version(1).stores(STORES_V1)
  const tables = v1Tables()
  await v1.transaction('rw', v1.tables, async () => {
    for (const [table, rows] of Object.entries(tables)) await v1.table(table).bulkAdd(rows)
  })
  v1.close()
  upgraded = new ForgeDB(name, () => UPGRADE_AT)
  await upgraded.open()
  return upgraded
}

describe('schema v1 → v2', () => {
  it('opens at version 2 with every table, the new ones empty but for the WGU assessments', async () => {
    const db = await openUpgraded()
    expect(db.verno).toBe(2)
    expect(db.tables.map((t) => t.name).sort()).toEqual([...TABLE_NAMES].sort())
    expect(await db.planProposals.count()).toBe(0)
    expect(await db.practiceQuestions.count()).toBe(0)
    expect(await db.questionAttempts.count()).toBe(0)
    expect(await db.readiness.count()).toBe(0)
  })

  it('moves the single v1 date to the do date and clears the deadline', async () => {
    const db = await openUpgraded()
    const v1 = new Map(v1Tables().tasks!.map((t) => [t.id as string, t]))
    const tasks = await db.tasks.toArray()
    expect(tasks).toHaveLength(v1.size)
    for (const t of tasks) {
      const old = v1.get(t.id) as Row
      expect(t.doDate).toBe(old.dueDate)
      expect(t.doTime).toBe(old.dueTime)
      expect(t.dueDate).toBeNull()
      expect(t.dueTime).toBeNull()
      expect(t.durationMinutes).toBe(old.estimateMinutes)
      expect(t.autoSlot).toBe(false)
      expect(t.assessmentId).toBeNull()
      expect(t.sync).toBeNull()
      expect(t.kind).toBe(
        old.source === 'schedule' ? 'study' : old.source === 'flashcards' ? 'review' : 'task',
      )
      // A migration is not an edit: timestamps are kept.
      expect([t.createdAt, t.updatedAt]).toEqual([old.createdAt, old.updatedAt])
    }
    expect(await db.tasks.get('task-c779-u3-2')).toMatchObject({
      doDate: TODAY,
      doTime: '10:00',
      durationMinutes: 45,
      kind: 'study',
    })
    expect(await db.tasks.get('task-cards-c779')).toMatchObject({ kind: 'review', doDate: TODAY })
    // The new index works.
    expect(await db.tasks.where('doDate').equals(TODAY).count()).toBeGreaterThan(3)
  })

  it('gives goals their planning, with windows from the user’s study start', async () => {
    const db = await openUpgraded()
    const goal = (await db.goals.get(WGU_GOAL_ID)) as Goal
    expect(goal.planning).toMatchObject({
      sessionMinutes: 50,
      shiftPattern: null,
      bufferPct: 0.12,
      cuHoursMultiplier: 15,
      asap: false,
      paceMinutesPerStudyDay: null,
    })
    // [90, 120, 120, 120, 120, 90, 180] from 07:30.
    expect(goal.planning.weekly[0]).toEqual([{ start: '07:30', end: '09:00' }])
    expect(goal.planning.weekly[1]).toEqual([{ start: '07:30', end: '09:30' }])
    expect(goal.planning.weekly[6]).toEqual([{ start: '07:30', end: '10:30' }])
    expect(goal.availability.minutesByWeekday).toEqual([90, 120, 120, 120, 120, 90, 180])
    expect((await db.goals.get('goal-no-target'))?.planning.asap).toBe(true)
  })

  it('gives units, courses and flashcards their v2 fields, and WGU courses their OAs', async () => {
    const db = await openUpgraded()
    for (const u of await db.units.toArray()) {
      expect(u).toMatchObject({
        selfRating: null,
        optional: false,
        baseEstimateMinutes: u.estimateMinutes,
        estimateSource: u.estimateMinutes === null ? 'course' : 'hours',
      })
    }
    for (const m of await db.milestones.toArray()) expect(m.selfRating).toBeNull()
    expect(await db.flashcards.get('card-1')).toMatchObject({
      scheduler: 'sm2',
      fsrs: null,
      noteRef: null,
      ease: 2.5,
    })
    const oas = await db.plannedAssessments.toArray()
    expect(oas).toHaveLength(5)
    expect(await db.plannedAssessments.get(`${COURSE_IDS.C779}:oa`)).toMatchObject({
      goalId: WGU_GOAL_ID,
      milestoneId: COURSE_IDS.C779,
      kind: 'exam',
      title: 'Objective assessment',
      date: null,
      status: 'planned',
      source: 'wgu',
      createdAt: UPGRADE_AT,
    })
    // The finished course's is already done, so the planner never places it.
    expect((await db.plannedAssessments.get(`${COURSE_IDS.C182}:oa`))?.status).toBe('done')
  })

  it('fills the new settings default, and a trashed v1 task comes back as a v2 row', async () => {
    const db = await openUpgraded()
    const settings = await db.settings.get('app')
    expect(settings?.scheduling.taskWindows).toHaveLength(7)
    expect(settings?.scheduling.taskWindows[0]).toEqual([{ start: '09:00', end: '21:00' }])
    expect(settings?.scheduling.defaultStudyStart).toBe('07:30')
    const item = await db.trash.get('trash-1')
    expect((item?.payload.tasks?.[0] as Task).kind).toBe('task')
    expect((item?.payload.tasks?.[0] as Task).doDate).toBe('2026-09-26')
  })

  it('is idempotent: running the upgrade again changes nothing', async () => {
    const db = await openUpgraded()
    // Outside a real upgrade the timestamp hook stamps what `modify` touches, so compare the data.
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          db.tables.map(
            async (t) =>
              [t.name, (await t.toArray()).map((r: Row) => ({ ...r, updatedAt: 0 }))] as const,
          ),
        ),
      )
    const before = await snapshot()
    await db.transaction('rw', db.tables, (tx) => upgradeV2(tx, UPGRADE_AT + 5_000))
    expect(await snapshot()).toEqual(before)
    // And the row mappings themselves.
    for (const t of await db.tasks.toArray()) expect(taskToV2(t)).toEqual(t)
    for (const g of await db.goals.toArray())
      expect(goalToV2(g, { studyStart: '06:00' })).toEqual(g)
    for (const u of await db.units.toArray()) expect(unitToV2(u)).toEqual(u)
    // Reopening a v2 database runs no upgrade.
    db.close()
    const again = new ForgeDB(name, () => UPGRADE_AT + 10_000)
    await again.open()
    expect((await again.tasks.toArray()).map((r) => ({ ...r, updatedAt: 0 }))).toEqual(before.tasks)
    again.close()
  })

  it('a v1 backup migrates to exactly what the upgraded database holds', async () => {
    const db = await openUpgraded()
    const file = { app: 'forge', format: 1, schemaVersion: 1, tables: v1Tables() }
    const migrated = migrateBackupV1toV2(file, UPGRADE_AT)
    expect(migrated.schemaVersion).toBe(2)
    for (const name of [
      'tasks',
      'goals',
      'milestones',
      'units',
      'flashcards',
      'trash',
      'settings',
    ]) {
      const rows = (await db.table(name).toArray()) as Row[]
      const byId = (a: Row, b: Row) => String(a.id).localeCompare(String(b.id))
      expect([...(migrated.tables[name] as Row[])].sort(byId), name).toEqual(rows.sort(byId))
    }
    const assessments = (await db.plannedAssessments.toArray()).sort((a, b) =>
      a.id.localeCompare(b.id),
    )
    expect(
      [...(migrated.tables.plannedAssessments as Row[])].sort((a, b) =>
        String(a.id).localeCompare(String(b.id)),
      ),
    ).toEqual(assessments)
    expect(migrated.tables.planProposals).toEqual([])
    // A v2 file is left alone.
    expect(migrateBackupV1toV2(migrated, UPGRADE_AT)).toBe(migrated)
  })
})
