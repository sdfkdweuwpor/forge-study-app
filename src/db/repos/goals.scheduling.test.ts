/**
 * `rebalanceGoal` with the slot planner (schema v2, PLAN §4.6): the plan's items become tasks with a
 * kind, a do date and time and a duration, reconciled by key on every run.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildStarterData } from '@/data/sample/starterTasks'
import { buildWguBsCs } from '@/data/sample/wguBsCs'
import { db } from '@/db/db'
import { onDomainEvent, resetDomainEvents, settleDomainEvents, type DomainEvent } from '@/db/events'
import { computeRemaining, rebalanceGoal } from '@/db/repos/goals'
import { updateSettings } from '@/db/repos/settings'
import { completeTask, createTask, moveTask, skipTask, updateTask } from '@/db/repos/tasks'
import type { Task } from '@/db/types'
import { atTime } from '@/logic/dates'
import { avail, goalRow, milestoneRow, unitRow, week } from '@/logic/scheduler/fixtures'

/** Monday 2026-10-05, 08:00 local. */
const MON = atTime('2026-10-05', '08:00')
const at = (day: string, time = '08:00') => atTime(day, time)

let events: DomainEvent[] = []

beforeEach(async () => {
  resetDomainEvents()
  events = []
  for (const type of ['task.created', 'task.changed', 'task.deleted', 'goal.changed'] as const) {
    onDomainEvent(type, (e: DomainEvent) => void events.push(e))
  }
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

/**
 * Course A (120 + 180 min, active) then B (150 min); windows Mon–Fri 09:00–10:00 and Sat 09:00–11:00
 * (the fixture's minutes as windows from 09:00), 50-minute sessions. No target: ASAP.
 */
async function seedGoal(extra: Parameters<typeof goalRow>[0] = {}): Promise<void> {
  await db.goals.add(goalRow({ availability: avail(week(60, 120, 0)), ...extra }))
  await db.milestones.bulkAdd([
    milestoneRow('a', { order: 0, status: 'active' }),
    milestoneRow('b', { order: 1 }),
  ])
  await db.units.bulkAdd([
    unitRow('a1', 'a', 120),
    unitRow('a2', 'a', 180, { order: 1 }),
    unitRow('b1', 'b', 150),
  ])
}

const byTime = (x: Task, y: Task): number =>
  `${x.doDate} ${x.doTime ?? '99:99'}`.localeCompare(`${y.doDate} ${y.doTime ?? '99:99'}`)

const planTasks = async (): Promise<Task[]> =>
  (await db.tasks.toArray()).filter((t) => t.source === 'schedule').sort(byTime)

const study = async (): Promise<Task[]> => (await planTasks()).filter((t) => t.kind === 'study')

const byKey = async (key: string): Promise<Task> =>
  (await db.tasks.where('scheduleKey').equals(key).first()) as Task

describe('rebalanceGoal (slot planner)', () => {
  it('materialises the plan as timed tasks with kinds, and caches the projection', async () => {
    await seedGoal()
    const summary = await rebalanceGoal('goal-1', { now: MON, reason: 'wizard' })
    expect(summary).toMatchObject({
      inserted: 10,
      updated: 0,
      removed: 0,
      trashed: 0,
      changed: true,
    })

    expect(
      (await study()).map((t) => [t.doDate, t.doTime, t.durationMinutes, t.scheduleKey]),
    ).toEqual([
      ['2026-10-05', '09:00', 60, 'a1:1'],
      ['2026-10-06', '09:00', 60, 'a1:2'],
      ['2026-10-07', '09:00', 45, 'a2:1'],
      ['2026-10-08', '09:00', 45, 'a2:2'],
      // 90 minutes fit in one session, so they wait for Saturday's two-hour window.
      ['2026-10-10', '09:00', 90, 'a2:3'],
      ['2026-10-10', '10:30', 30, 'b1:1'],
      ['2026-10-12', '09:00', 60, 'b1:2'],
      ['2026-10-13', '09:00', 60, 'b1:3'],
    ])
    expect(await byKey('b1:1')).toMatchObject({
      title: 'B · Topic b1 (1/3)',
      kind: 'study',
      goalId: 'goal-1',
      milestoneId: 'b',
      unitId: 'b1',
      estimateMinutes: 30,
      estimatePomodoros: 1,
      status: 'todo',
      schedulePinned: false,
      orderInDay: 1,
      dueDate: null,
    })
    // Weekly milestones are day markers: no time, no duration, dated on the week's last work day.
    const markers = (await planTasks()).filter((t) => t.kind === 'milestone')
    expect(markers.map((t) => [t.scheduleKey, t.doDate, t.doTime, t.durationMinutes])).toEqual([
      ['milestone:2026-10-05', '2026-10-10', null, null],
      ['milestone:2026-10-12', '2026-10-13', null, null],
    ])
    expect(markers[0]?.title).toBe('Week of Oct 5 — finish A Units 1–2')

    const goal = await db.goals.get('goal-1')
    expect(goal?.projection).toMatchObject({ end: '2026-10-13', slipDays: 0, feasible: true })
    expect(goal?.baselineEnd).toBe('2026-10-13')
    expect(goal?.lastRebalancedOn).toBe('2026-10-05')
    expect(goal?.planning.paceMinutesPerStudyDay).toBeNull()
    expect(await db.milestones.get('b')).toMatchObject({
      projectedStart: '2026-10-10',
      projectedEnd: '2026-10-13',
    })
    await settleDomainEvents()
    expect(events.filter((e) => e.type === 'task.created')).toHaveLength(10)
    expect(events.filter((e) => e.type === 'goal.changed')).toHaveLength(1)
  })

  it('paces to a target, keeps the pace, and never plans past the target with the buffer', async () => {
    await seedGoal({ targetDate: '2026-10-31' })
    const summary = await rebalanceGoal('goal-1', { now: MON, reason: 'wizard' })
    expect(summary?.result.pace.mode).toBe('target')
    const goal = await db.goals.get('goal-1')
    expect(goal?.planning.paceMinutesPerStudyDay).toBe(summary?.result.pace.minutesPerStudyDay)
    expect(goal?.projection?.feasible).toBe(true)
    expect(
      summary?.result.buffer.bufferedEnd && summary.result.buffer.bufferedEnd <= '2026-10-31',
    ).toBe(true)
    // Paced, so the work is spread out: it ends later than the ASAP plan (Oct 13).
    expect((goal?.projection?.end ?? '') > '2026-10-13').toBe(true)
  })

  it('is idempotent: a second run writes nothing and emits nothing', async () => {
    await seedGoal()
    await rebalanceGoal('goal-1', { now: MON })
    const before = await db.tasks.toArray()
    const goalBefore = await db.goals.get('goal-1')
    await settleDomainEvents()
    events = []

    const again = await rebalanceGoal('goal-1', { now: MON + 3_600_000 })
    expect(again).toMatchObject({ inserted: 0, updated: 0, removed: 0, trashed: 0, changed: false })
    expect(await db.tasks.toArray()).toEqual(before)
    expect(await db.goals.get('goal-1')).toEqual(goalBefore)
    await settleDomainEvents()
    expect(events).toEqual([])
  })

  it('moves a missed day forward by updating the same study tasks', async () => {
    await seedGoal()
    await rebalanceGoal('goal-1', { now: MON })
    const ids = (await study()).map((t) => t.id).sort()
    const summary = await rebalanceGoal('goal-1', { now: at('2026-10-06'), reason: 'daily' })
    expect(summary).toMatchObject({ removed: 0, trashed: 0 })
    const after = await study()
    expect(after.map((t) => t.id).sort()).toEqual(ids)
    expect(after.every((t) => (t.doDate as string) >= '2026-10-06')).toBe(true)
    expect(await byKey('a1:1')).toMatchObject({ doDate: '2026-10-06', doTime: '09:00' })
    // The unused Friday slot absorbs the missed day: the end holds.
    expect(await byKey('a2:2')).toMatchObject({ doDate: '2026-10-09' })
    expect((await db.goals.get('goal-1'))?.projection?.end).toBe('2026-10-13')
  })

  it('keeps today as planned when a session is finished, and pulls work forward when a course ends early', async () => {
    await seedGoal()
    await rebalanceGoal('goal-1', { now: MON })
    await completeTask((await byKey('a1:1')).id, { now: at('2026-10-05', '10:00') })
    const same = await rebalanceGoal('goal-1', {
      now: at('2026-10-05', '10:05'),
      reason: 'complete',
    })
    expect(same?.changed).toBe(false)

    const bFirst = (await byKey('b1:1')).doDate as string
    await db.milestones.update('a', { status: 'done' })
    const early = await rebalanceGoal('goal-1', {
      now: at('2026-10-05', '10:10'),
      reason: 'complete',
    })
    expect(early?.removed).toBeGreaterThanOrEqual(4) // a1:2, a2:1–3 (and a marker)
    const left = await study()
    expect(left.filter((t) => t.milestoneId === 'a' && t.status !== 'done')).toEqual([])
    expect(((await byKey('b1:1')).doDate as string) < bFirst).toBe(true)
    expect((await byKey('a1:1')).status).toBe('done')
  })

  it('leaves a moved (pinned) session where the user put it and plans around it', async () => {
    await seedGoal()
    await rebalanceGoal('goal-1', { now: MON })
    const t = await byKey('a2:1')
    await moveTask(t.id, { doDate: '2026-10-10', doTime: '09:00' }, { now: MON })
    expect((await db.tasks.get(t.id))?.schedulePinned).toBe(true)

    const summary = await rebalanceGoal('goal-1', { now: MON + 60_000, reason: 'edit' })
    expect(summary?.changed).toBe(true)
    expect(await db.tasks.get(t.id)).toMatchObject({ doDate: '2026-10-10', doTime: '09:00' })
    // Nothing else overlaps the pinned slot.
    const sat = (await study()).filter((x) => x.doDate === '2026-10-10' && x.id !== t.id)
    for (const x of sat) expect((x.doTime as string) >= '09:55').toBe(true)
    expect((await rebalanceGoal('goal-1', { now: MON + 120_000 }))?.changed).toBe(false)
  })

  it('moves a skipped session off today, and stays put on the next run', async () => {
    await seedGoal({ availability: avail(week(120)) })
    await rebalanceGoal('goal-1', { now: MON })
    const today = (await study()).filter((t) => t.doDate === '2026-10-05')
    expect(today.length).toBe(2)
    const load = today.reduce((n, t) => n + (t.durationMinutes ?? 0), 0)
    const skipped = today[0] as Task
    await skipTask(skipped.id, { now: MON })
    await rebalanceGoal('goal-1', { now: MON + 1000, reason: 'skip' })
    const moved = await db.tasks.get(skipped.id)
    expect((moved?.doDate as string) > '2026-10-05').toBe(true)
    // Today gives that time up: it holds one session less.
    const rest = (await study()).filter(
      (t) => t.doDate === '2026-10-05' && t.skippedOn !== '2026-10-05',
    )
    expect(rest.reduce((n, t) => n + (t.durationMinutes ?? 0), 0)).toBeLessThanOrEqual(
      load - (skipped.durationMinutes ?? 0),
    )
    expect((await rebalanceGoal('goal-1', { now: MON + 2000 }))?.changed).toBe(false)
  })

  it('never plans over another task that holds a time', async () => {
    await seedGoal()
    await createTask(
      { title: 'Dentist', doDate: '2026-10-06', doTime: '09:00', durationMinutes: 60 },
      { now: MON },
    )
    await rebalanceGoal('goal-1', { now: MON })
    expect((await study()).some((t) => t.doDate === '2026-10-06')).toBe(false)
  })

  it('trashes (detached) an item the plan drops when it carries the user’s notes', async () => {
    await seedGoal()
    await rebalanceGoal('goal-1', { now: MON })
    const noted = await byKey('b1:3')
    await updateTask(
      noted.id,
      { notes: [{ id: 'n', type: 'p', text: 'Ask about lab 3' }] },
      { now: MON },
    )
    await db.units.update('b1', { status: 'done' })
    const summary = await rebalanceGoal('goal-1', { now: MON + 1000, reason: 'complete' })
    expect(summary?.trashed).toBe(1)
    expect(await db.tasks.get(noted.id)).toBeUndefined()
    const [item] = await db.trash.toArray()
    const saved = (item?.payload.tasks ?? [])[0] as Task
    expect(saved).toMatchObject({ id: noted.id, source: 'user', kind: 'task', scheduleKey: null })
    expect(saved.notes[0]?.text).toBe('Ask about lab 3')
  })

  it('merges the global days off from settings', async () => {
    await seedGoal()
    await updateSettings({
      scheduling: { globalDaysOff: [{ start: '2026-10-05', end: '2026-10-06' }] },
    })
    await rebalanceGoal('goal-1', { now: MON })
    const dates = (await study()).map((t) => t.doDate)
    expect(dates).not.toContain('2026-10-05')
    expect(dates).not.toContain('2026-10-06')
  })

  it('plans reviews, a practice test and the exam for a dated planned assessment', async () => {
    await seedGoal()
    await db.plannedAssessments.add({
      id: 'oa-b',
      goalId: 'goal-1',
      milestoneId: 'b',
      kind: 'exam',
      title: 'Objective assessment',
      date: '2026-10-23',
      time: null,
      durationMinutes: null,
      status: 'planned',
      completedAt: null,
      order: 0,
      source: 'user',
    })
    await rebalanceGoal('goal-1', { now: MON })
    const items = await planTasks()
    const exam = items.find((t) => t.kind === 'assessment')
    expect(exam).toMatchObject({
      scheduleKey: 'assessment:oa-b',
      assessmentId: 'oa-b',
      doDate: '2026-10-23',
      dueDate: '2026-10-23',
      doTime: null,
    })
    const practice = items.find((t) => t.kind === 'practiceTest')
    expect(practice).toMatchObject({ scheduleKey: 'practice:oa-b', dueDate: '2026-10-23' })
    const reviews = items.filter((t) => t.kind === 'review')
    expect(reviews.length).toBeGreaterThan(0)
    for (const r of [practice, ...reviews]) {
      expect(r?.assessmentId).toBe('oa-b')
      expect((r?.doDate as string) < '2026-10-23').toBe(true)
      expect(r?.doTime).not.toBeNull()
    }
    // Checking the exam off marks the assessment done for the planner: no more reviews for it.
    await completeTask((exam as Task).id, { now: MON })
    await rebalanceGoal('goal-1', { now: MON + 1000 })
    expect((await planTasks()).filter((t) => t.kind === 'review' && t.status !== 'done')).toEqual(
      [],
    )
  })

  it('adopts the hand-written chunks of the WGU sample by key', async () => {
    const today = '2026-09-29'
    const now = atTime(today, '09:30')
    const { goal, milestones, units, plannedAssessments } = buildWguBsCs(today, now)
    const { tasks } = buildStarterData({ today, now })
    await db.goals.add(goal)
    await db.milestones.bulkAdd(milestones)
    await db.units.bulkAdd(units)
    await db.plannedAssessments.bulkAdd(plannedAssessments)
    await db.tasks.bulkAdd(tasks)
    const openSeeded = tasks
      .filter((t) => t.source === 'schedule' && t.status !== 'done')
      .map((t) => t.id)

    const summary = await rebalanceGoal(goal.id, { now, reason: 'daily' })
    expect(summary).toMatchObject({ removed: 0, trashed: 0 })
    for (const id of openSeeded) expect(await db.tasks.get(id)).toBeDefined()
    // Carried over two days: it moves to today or later.
    expect(((await db.tasks.get('task-c779-u2-3'))?.doDate ?? '') >= today).toBe(true)
    expect(summary?.projection.feasible).toBe(true)
    // The finished course's OA is done; the others are planned after their course.
    const exams = (await planTasks()).filter((t) => t.kind === 'assessment')
    expect(exams.map((t) => t.assessmentId)).not.toContain('course-c182:oa')
    expect(exams.length).toBe(4)
    expect((await rebalanceGoal(goal.id, { now: now + 1000 }))?.changed).toBe(false)
  })

  it('returns null for a missing goal', async () => {
    expect(await rebalanceGoal('nope', { now: MON })).toBeNull()
  })
})

describe('computeRemaining', () => {
  it('sums minutes done and left per course (study sessions only)', async () => {
    await seedGoal()
    await rebalanceGoal('goal-1', { now: MON })
    await completeTask((await byKey('a1:1')).id, { now: MON })
    await completeTask((await byKey('milestone:2026-10-05')).id, { now: MON })
    await db.units.update('a2', { status: 'done' })
    const work = await computeRemaining('goal-1')
    expect(work).toMatchObject({ totalMinutes: 450, doneMinutes: 240, remainingMinutes: 210 })
    expect(work?.courses.map((c) => [c.courseId, c.doneMinutes, c.remainingMinutes])).toEqual([
      ['a', 240, 60],
      ['b', 0, 150],
    ])
    expect(await computeRemaining('nope')).toBeNull()
  })
})
