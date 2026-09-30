/**
 * Performance budgets at the size a year-long degree reaches: the WGU sample plus a year of study on the
 * same goal (`?seed=wgu-year`: 2,000 finished study sessions and about 300 open ones). Budgets are CPU
 * time, the median of a few runs (`@/test/timing`), with wide margins over the typical figures noted
 * beside each, so a busy machine cannot fail them; what can be counted (rows written, events) is.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { WGU_GOAL_ID } from '@/data/sample/wguBsCs'
import { db } from '@/db/db'
import { onDomainEvent, resetDomainEvents, settleDomainEvents } from '@/db/events'
import { computeRemaining, rebalanceGoal } from '@/db/repos/goals'
import { loadGoalRows } from '@/db/repos/planning'
import { syncProgressAtStart } from '@/db/repos/progress'
import { runDailyPlanning } from '@/db/repos/proposals'
import { completeTask } from '@/db/repos/tasks'
import type { Task } from '@/db/types'
import { applySeed } from '@/dev/seed'
import { addDays, atTime, dayOf } from '@/logic/dates'
import { planGoalSlots } from '@/logic/scheduler'
import { cpuNow, medianCpuMs, medianCpuMsAsync } from '@/test/timing'

/** Tue 2026-09-29 09:30, the e2e clock. */
const NOW = atTime('2026-09-29', '09:30')
const TODAY = dayOf(NOW)

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

const goalTasks = (): Promise<Task[]> => db.tasks.where('goalId').equals(WGU_GOAL_ID).toArray()
/** The next open study sessions, soonest first (today's, then working ahead). */
const nextSessions = async (): Promise<Task[]> =>
  (await goalTasks())
    .filter((t) => t.status !== 'done' && t.kind === 'study' && t.doDate !== null)
    .sort((a, b) =>
      `${a.doDate} ${a.doTime ?? ''}`.localeCompare(`${b.doDate} ${b.doTime ?? ''}`),
    )

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  resetDomainEvents()
  await applySeed('wgu-year')
  await settleDomainEvents()
}, 120_000)

afterAll(() => {
  vi.useRealTimers()
  resetDomainEvents()
})

// Wall time is not what is measured, and it can be long on a busy machine.
describe('a year of study on one goal', { timeout: 120_000 }, () => {
  it('holds 2,000 finished and about 300 open plan tasks', async () => {
    const tasks = await goalTasks()
    const plan = tasks.filter((t) => t.source === 'schedule')
    expect(plan.filter((t) => t.status === 'done').length).toBeGreaterThanOrEqual(2000)
    const open = plan.filter((t) => t.status !== 'done').length
    expect(open).toBeGreaterThan(250)
    expect(open).toBeLessThan(450)
  })

  it('plans in memory well under 100 ms (typically 20–30)', async () => {
    const rows = await db.transaction('r', db.tables, () => loadGoalRows(WGU_GOAL_ID, TODAY))
    if (!rows) throw new Error('the goal is missing')
    expect(medianCpuMs(() => planGoalSlots(rows, TODAY), 3)).toBeLessThan(100)
  })

  it('re-plans in under 300 ms, and a re-plan with nothing new writes nothing', async () => {
    let events = 0
    const off = onDomainEvent('task.changed', () => void (events += 1))
    const again = await rebalanceGoal(WGU_GOAL_ID, { now: NOW, reason: 'edit' })
    await settleDomainEvents()
    off()
    expect(again?.changed).toBe(false)
    expect(again).toMatchObject({ inserted: 0, updated: 0, removed: 0, trashed: 0 })
    expect(events).toBe(0)
    // Typically 40–80 ms here (fake-indexeddb is slower than a browser's).
    expect(
      await medianCpuMsAsync(() => rebalanceGoal(WGU_GOAL_ID, { now: NOW, reason: 'edit' })),
    ).toBeLessThan(300)
  })

  it('finishes a task in under 100 ms and re-plans after it in under 300 ms, moving a few rows', async () => {
    const today = (await nextSessions()).filter((t) => t.doDate === TODAY)
    expect(today.length).toBeGreaterThanOrEqual(2)
    const complete: number[] = []
    const replan: number[] = []
    for (const task of today) {
      let t0 = cpuNow()
      const done = await completeTask(task.id, { now: NOW })
      complete.push(cpuNow() - t0)
      expect(done.task?.status).toBe('done')
      await settleDomainEvents()
      t0 = cpuNow()
      const summary = await rebalanceGoal(WGU_GOAL_ID, { now: NOW, reason: 'complete' })
      replan.push(cpuNow() - t0)
      // Finishing today's session keeps its slot, so only today's other sessions move.
      const written = (summary?.inserted ?? 0) + (summary?.updated ?? 0) + (summary?.removed ?? 0)
      expect(written).toBeLessThanOrEqual(12)
    }
    // Typically 10–30 ms, and 70–140 ms (each row fake-indexeddb updates costs it 20–30 ms of CPU).
    expect(Math.max(...complete)).toBeLessThan(100)
    expect(median(replan)).toBeLessThan(300)
  })

  it('pulls the whole plan forward after working ahead, planning it in under 100 ms', async () => {
    // Tomorrow's first session done today: every later session can move one slot earlier. That is the
    // plan working as designed (finished work pulls the rest forward), and it is one bulk write.
    const [ahead] = (await nextSessions()).filter((t) => t.doDate !== null && t.doDate > TODAY)
    if (!ahead) throw new Error('nothing planned after today')
    await completeTask(ahead.id, { now: NOW })
    await settleDomainEvents()
    const rows = await db.transaction('r', db.tables, () => loadGoalRows(WGU_GOAL_ID, TODAY))
    if (!rows) throw new Error('the goal is missing')
    const plan = planGoalSlots(rows, TODAY)
    const open = rows.tasks.filter((t) => t.source === 'schedule' && t.status !== 'done').length
    expect(plan.diff.update.length).toBeGreaterThan(50)
    // Each open row is written at most once, in place: sessions are moved, not recreated (a weekly
    // marker or a review can still come or go at the edges).
    expect(new Set(plan.diff.update.map((u) => u.id)).size).toBe(plan.diff.update.length)
    expect(plan.diff.update.length + plan.diff.remove.length).toBeLessThanOrEqual(open)
    expect(plan.diff.insert.length + plan.diff.remove.length).toBeLessThanOrEqual(10)
    expect(medianCpuMs(() => planGoalSlots(rows, TODAY), 3)).toBeLessThan(100)
    // Not written here: fake-indexeddb spends 20–30 ms of CPU per row it updates (seconds for this
    // diff), where a browser's IndexedDB writes it in one bulk put in tens of milliseconds.
  })

  it('computes hours done for the goal page in under 100 ms', async () => {
    const work = await computeRemaining(WGU_GOAL_ID)
    expect(work?.doneMinutes).toBeGreaterThan(2000 * 50 * 0.9)
    expect(await medianCpuMsAsync(() => computeRemaining(WGU_GOAL_ID))).toBeLessThan(100)
  })

  it('checks the whole streak history at app start in under 300 ms', async () => {
    const first = await syncProgressAtStart({ today: TODAY, now: NOW, full: true })
    expect(first.full).toBe(true)
    // Typically 20–60 ms; a second check writes nothing.
    const again = await syncProgressAtStart({ today: TODAY, now: NOW, full: true })
    expect(again).toMatchObject({ written: 0, removed: 0 })
    expect(
      await medianCpuMsAsync(() => syncProgressAtStart({ today: TODAY, now: NOW, full: true })),
    ).toBeLessThan(300)
  })

  it('rolls the plan forward on the next day in under 500 ms', async () => {
    const tomorrow = atTime(addDays(TODAY, 1), '07:00')
    vi.setSystemTime(tomorrow)
    try {
      const t0 = cpuNow()
      const run = await runDailyPlanning({ now: tomorrow })
      const ms = cpuNow() - t0
      expect(run.errors).toEqual([])
      expect(run.outcomes.map((o) => o.goalId)).toEqual([WGU_GOAL_ID])
      // Typically 100–200 ms: the roll-forward, plus the proposals when the plan is far behind.
      expect(ms).toBeLessThan(500)
      // A second open the same day does nothing.
      expect((await runDailyPlanning({ now: tomorrow })).outcomes).toEqual([])
    } finally {
      vi.setSystemTime(NOW)
    }
  })
})

// Cloud sync's change tracking (PLAN §4.7.4) must not move these budgets: with sync on, each write
// also queues one outbox entry per record, in the same transaction.
describe('a year of study with cloud sync on', { timeout: 120_000 }, () => {
  beforeAll(async () => {
    db.syncTracker.setEnabled(true)
    await db.syncOutbox.clear()
  })
  afterAll(async () => {
    db.syncTracker.setEnabled(false)
    await db.syncOutbox.clear()
  })

  it('re-plans in under 300 ms, and a re-plan with nothing new queues nothing', async () => {
    await rebalanceGoal(WGU_GOAL_ID, { now: NOW, reason: 'edit' })
    await db.syncOutbox.clear()
    const again = await rebalanceGoal(WGU_GOAL_ID, { now: NOW, reason: 'edit' })
    expect(again?.changed).toBe(false)
    expect(await db.syncOutbox.count()).toBe(0)
    expect(
      await medianCpuMsAsync(() => rebalanceGoal(WGU_GOAL_ID, { now: NOW, reason: 'edit' })),
    ).toBeLessThan(300)
  })

  it('finishes a task in under 100 ms, queuing the task and its XP; the re-plan queues a few rows', async () => {
    const [task] = (await nextSessions()).filter((t) => t.status !== 'done')
    if (!task) throw new Error('no open session')
    await db.syncOutbox.clear()
    const t0 = cpuNow()
    await completeTask(task.id, { now: NOW })
    const ms = cpuNow() - t0
    await settleDomainEvents()
    const queued = (await db.syncOutbox.toArray()).map((e) => `${e.tbl}:${e.id}`)
    expect(queued).toContain(`tasks:${task.id}`)
    expect(queued).toContain(`xpEvents:xp:task:${task.id}#0`)
    expect(ms).toBeLessThan(100)

    await db.syncOutbox.clear()
    const summary = await rebalanceGoal(WGU_GOAL_ID, { now: NOW, reason: 'complete' })
    const written = (summary?.inserted ?? 0) + (summary?.updated ?? 0) + (summary?.removed ?? 0)
    // One entry per record written (the goal and its courses' projections may be rewritten too).
    expect(await db.syncOutbox.count()).toBeGreaterThanOrEqual(written)
    expect(await db.syncOutbox.count()).toBeLessThanOrEqual(written + 30)
  })
})
