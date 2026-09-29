import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildStarterData } from '@/data/sample/starterTasks'
import { buildWguBsCs } from '@/data/sample/wguBsCs'
import { db } from '@/db/db'
import { onDomainEvent, resetDomainEvents, settleDomainEvents, type DomainEvent } from '@/db/events'
import { computeRemaining, rebalanceGoal } from '@/db/repos/goals'
import { updateSettings } from '@/db/repos/settings'
import { completeTask, moveTask, skipTask, updateTask } from '@/db/repos/tasks'
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

/** Course A (120 + 180 min, active) then B (150 min); Mon–Fri 60, Sat 120. */
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

const scheduled = async (): Promise<Task[]> =>
  (await db.tasks.toArray())
    .filter((t) => t.source === 'schedule')
    .sort((x, y) => (x.dueDate ?? '').localeCompare(y.dueDate ?? '') || x.orderInDay - y.orderInDay)

const byKey = async (key: string): Promise<Task> =>
  (await db.tasks.where('scheduleKey').equals(key).first()) as Task

describe('rebalanceGoal', () => {
  it('materialises the plan as scheduled tasks and caches the projection', async () => {
    await seedGoal({ targetDate: '2026-10-31' })
    const summary = await rebalanceGoal('goal-1', { now: MON, reason: 'wizard' })
    expect(summary).toMatchObject({
      inserted: 8,
      updated: 0,
      removed: 0,
      trashed: 0,
      changed: true,
    })

    const tasks = await scheduled()
    expect(tasks.map((t) => [t.dueDate, t.scheduleKey, t.estimateMinutes])).toEqual([
      ['2026-10-05', 'a1:1', 60],
      ['2026-10-06', 'a1:2', 60],
      ['2026-10-07', 'a2:1', 60],
      ['2026-10-08', 'a2:2', 60],
      ['2026-10-09', 'a2:3', 60],
      ['2026-10-10', 'b1:1', 90],
      ['2026-10-10', 'b1:2', 30],
      ['2026-10-12', 'b1:3', 30],
    ])
    expect(tasks[5]).toMatchObject({
      title: 'B · Topic b1 (1/3)',
      goalId: 'goal-1',
      milestoneId: 'b',
      unitId: 'b1',
      estimatePomodoros: 4,
      status: 'todo',
      schedulePinned: false,
      orderInDay: 0,
    })

    const goal = await db.goals.get('goal-1')
    expect(goal?.projection).toMatchObject({
      end: '2026-10-12',
      slipDays: -19,
      feasible: true,
      issues: [],
    })
    expect(goal?.baselineEnd).toBe('2026-10-12')
    expect(goal?.lastRebalancedOn).toBe('2026-10-05')
    expect(await db.milestones.get('b')).toMatchObject({
      projectedStart: '2026-10-10',
      projectedEnd: '2026-10-12',
    })
    await settleDomainEvents()
    expect(events.filter((e) => e.type === 'task.created')).toHaveLength(8)
    expect(events.filter((e) => e.type === 'goal.changed')).toHaveLength(1)
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

  it('moves a missed day forward by updating the same tasks', async () => {
    await seedGoal()
    await rebalanceGoal('goal-1', { now: MON })
    const ids = (await scheduled()).map((t) => t.id).sort()
    const summary = await rebalanceGoal('goal-1', { now: at('2026-10-06'), reason: 'daily' })
    expect(summary).toMatchObject({ inserted: 0, removed: 0, trashed: 0 })
    const after = await scheduled()
    expect(after.map((t) => t.id).sort()).toEqual(ids)
    expect(after.every((t) => (t.dueDate as string) >= '2026-10-06')).toBe(true)
    expect((await byKey('a1:1')).dueDate).toBe('2026-10-06')
    expect((await db.goals.get('goal-1'))?.projection?.end).toBe('2026-10-13')
  })

  it('keeps today as planned when a chunk is finished, and pulls work forward when a course ends early', async () => {
    await seedGoal()
    await rebalanceGoal('goal-1', { now: MON })
    await completeTask((await byKey('a1:1')).id, { now: at('2026-10-05', '09:00') })
    const same = await rebalanceGoal('goal-1', {
      now: at('2026-10-05', '09:30'),
      reason: 'complete',
    })
    expect(same?.changed).toBe(false)

    const bFirst = (await byKey('b1:1')).dueDate as string
    await db.milestones.update('a', { status: 'done' })
    const early = await rebalanceGoal('goal-1', {
      now: at('2026-10-05', '10:00'),
      reason: 'complete',
    })
    expect(early?.removed).toBe(4) // a1:2, a2:1–3
    const left = await scheduled()
    expect(left.filter((t) => t.milestoneId === 'a' && t.status !== 'done')).toEqual([])
    expect(((await byKey('b1:1')).dueDate as string) < bFirst).toBe(true)
    expect((await byKey('a1:1')).status).toBe('done')
  })

  it('leaves a moved (pinned) task where the user put it and plans around it', async () => {
    await seedGoal()
    await rebalanceGoal('goal-1', { now: MON })
    const t = await byKey('a2:1')
    await moveTask(t.id, { dueDate: '2026-10-10' }, { now: MON })
    expect((await db.tasks.get(t.id))?.schedulePinned).toBe(true)

    const summary = await rebalanceGoal('goal-1', { now: MON + 60_000, reason: 'edit' })
    expect(summary?.changed).toBe(true)
    expect((await db.tasks.get(t.id))?.dueDate).toBe('2026-10-10')
    const sat = (await scheduled()).filter((x) => x.dueDate === '2026-10-10')
    expect(sat.reduce((s, x) => s + (x.estimateMinutes ?? 0), 0)).toBeLessThanOrEqual(120)
    expect((await rebalanceGoal('goal-1', { now: MON + 120_000 }))?.changed).toBe(false)
  })

  it('moves a skipped task off today, and stays put on the next run', async () => {
    await seedGoal({ availability: avail(week(90)) })
    await rebalanceGoal('goal-1', { now: MON })
    const today = (await scheduled()).filter((t) => t.dueDate === '2026-10-05')
    expect(today.length).toBeGreaterThan(0)
    const skipped = today[0] as Task
    await skipTask(skipped.id, { now: MON })
    await rebalanceGoal('goal-1', { now: MON + 1000, reason: 'skip' })
    const moved = await db.tasks.get(skipped.id)
    expect((moved?.dueDate as string) > '2026-10-05').toBe(true)
    const load = (await scheduled())
      .filter((t) => t.dueDate === '2026-10-05' && t.skippedOn !== '2026-10-05')
      .reduce((s, t) => s + (t.estimateMinutes ?? 0), 0)
    expect(load).toBeLessThanOrEqual(90 - (skipped.estimateMinutes ?? 0))
    expect((await rebalanceGoal('goal-1', { now: MON + 2000 }))?.changed).toBe(false)
  })

  it('trashes (detached) a chunk the plan drops when it carries the user’s notes', async () => {
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
    expect(summary).toMatchObject({ trashed: 1, removed: 2 })
    expect(await db.tasks.get(noted.id)).toBeUndefined()
    const [item] = await db.trash.toArray()
    const saved = (item?.payload.tasks ?? [])[0] as Task
    expect(saved).toMatchObject({ id: noted.id, source: 'user', scheduleKey: null })
    expect(saved.notes[0]?.text).toBe('Ask about lab 3')
  })

  it('merges the global days off from settings', async () => {
    await seedGoal()
    await updateSettings({
      scheduling: { globalDaysOff: [{ start: '2026-10-05', end: '2026-10-06' }] },
    })
    await rebalanceGoal('goal-1', { now: MON })
    const dates = (await scheduled()).map((t) => t.dueDate)
    expect(dates).not.toContain('2026-10-05')
    expect(dates).not.toContain('2026-10-06')
  })

  it('adopts the hand-written chunks of the WGU sample by key', async () => {
    const today = '2026-09-29'
    const now = atTime(today, '09:30')
    const { goal, milestones, units } = buildWguBsCs(today, now)
    const { tasks } = buildStarterData({ today, now })
    await db.goals.add(goal)
    await db.milestones.bulkAdd(milestones)
    await db.units.bulkAdd(units)
    await db.tasks.bulkAdd(tasks)
    const openSeeded = tasks
      .filter((t) => t.source === 'schedule' && t.status !== 'done')
      .map((t) => t.id)

    const summary = await rebalanceGoal(goal.id, { now, reason: 'daily' })
    expect(summary).toMatchObject({ removed: 0, trashed: 0 })
    for (const id of openSeeded) expect(await db.tasks.get(id)).toBeDefined()
    expect((await db.tasks.get('task-c779-u2-3'))?.dueDate).toBe(today) // rolled over → today
    expect(summary?.result.feasible).toBe(true)
    expect((await rebalanceGoal(goal.id, { now: now + 1000 }))?.changed).toBe(false)
  })

  it('returns null for a missing goal', async () => {
    expect(await rebalanceGoal('nope', { now: MON })).toBeNull()
  })
})

describe('computeRemaining', () => {
  it('sums minutes done and left per course', async () => {
    await seedGoal()
    await rebalanceGoal('goal-1', { now: MON })
    await completeTask((await byKey('a1:1')).id, { now: MON })
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
