import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { getBadges } from '@/db/repos/badges'
import { resetDomainEvents, settleDomainEvents } from '@/db/events'
import {
  loadStreak,
  needsFullRebuild,
  syncProgressAtStart,
  rebuildAll,
  rebuildDays,
  reconcileStreakMilestones,
  refreshDay,
} from '@/db/repos/progress'
import { ensureSettings, updateSettings } from '@/db/repos/settings'
import { completeTask, createTask, uncompleteTask } from '@/db/repos/tasks'
import { xpNetForKey } from '@/db/repos/xp'
import type { ISODate, Session, StreakDay } from '@/db/types'
import { addDays } from '@/logic/dates'

const TODAY = '2026-09-29' // a Tuesday
const NOW = new Date(2026, 8, 29, 9, 30).getTime()

let seq = 0

/** A finished, counted 25-minute pomodoro that started on `day`. */
async function addSession(day: ISODate, over: Partial<Session> = {}): Promise<void> {
  seq += 1
  const startedAt = new Date(`${day}T08:00:00`).getTime() + seq * 60_000
  await db.sessions.add({
    id: `s${seq}`,
    createdAt: startedAt,
    updatedAt: startedAt,
    kind: 'focus',
    mode: 'pomodoro',
    status: 'completed',
    taskId: null,
    goalId: null,
    milestoneId: null,
    day,
    startedAt,
    endedAt: startedAt + 25 * 60_000,
    plannedMinutes: 25,
    pausedMs: 0,
    pausedAt: null,
    actualMinutes: 25,
    round: seq,
    interrupted: false,
    counted: true,
    note: null,
    ...over,
  })
}

/** One counted session on each of `count` days ending on `last`. */
async function addRun(last: ISODate, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await addSession(addDays(last, -i))
}

const row = (day: ISODate): Promise<StreakDay | undefined> => db.streakDays.get(day)

beforeEach(async () => {
  resetDomainEvents()
  await Promise.all(db.tables.map((t) => t.clear()))
  await ensureSettings()
  await updateSettings({ dailyGoalPomodoros: 3, weekStartsOn: 1 })
})

afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

describe('rebuildDays', () => {
  it('derives a day from its counted sessions, finished tasks and XP', async () => {
    await addSession('2026-09-28')
    await addSession('2026-09-28', { actualMinutes: 30, plannedMinutes: 30 })
    await addSession('2026-09-28', { counted: false })
    await addSession('2026-09-28', { kind: 'break', actualMinutes: 5, plannedMinutes: 5 })
    const task = await createTask({ title: 'Read chapter 4 of D278' }, { now: NOW })
    const done = await completeTask(task.id, { now: new Date(2026, 8, 28, 20).getTime() })
    expect(done.xp).toBeGreaterThan(0)

    const result = await rebuildDays('2026-09-27', '2026-09-29', { today: TODAY })
    expect(result).toEqual({ written: 1, removed: 0 })
    expect(await row('2026-09-28')).toMatchObject({
      id: '2026-09-28',
      day: '2026-09-28',
      focusSessions: 2,
      focusMinutes: 55,
      pomodoros: 2,
      tasksDone: 1,
      dailyGoalTarget: 3,
      dailyGoalHit: false,
      qualified: true,
      xp: done.xp,
    })
    expect(await row('2026-09-27')).toBeUndefined()
  })

  it('marks the daily goal as hit and qualifies the day by it', async () => {
    for (let i = 0; i < 3; i++) await addSession(TODAY)
    await rebuildDays(TODAY, TODAY, { today: TODAY })
    expect(await row(TODAY)).toMatchObject({ pomodoros: 3, dailyGoalHit: true, qualified: true })
  })

  it('does not qualify a day of finished tasks alone', async () => {
    const task = await createTask({ title: 'Email the mentor' }, { now: NOW })
    await completeTask(task.id, { now: NOW })
    await refreshDay(TODAY, { today: TODAY })
    expect(await row(TODAY)).toMatchObject({ tasksDone: 1, focusSessions: 0, qualified: false })
  })

  it('is idempotent: a second run writes nothing and leaves updatedAt alone', async () => {
    await addSession('2026-09-28')
    await rebuildDays('2026-09-20', TODAY, { today: TODAY })
    const first = await row('2026-09-28')
    const again = await rebuildDays('2026-09-20', TODAY, { today: TODAY })
    expect(again).toEqual({ written: 0, removed: 0 })
    expect(await row('2026-09-28')).toEqual(first)
  })

  it('keeps createdAt when a row changes, and removes a row whose day went quiet', async () => {
    await addSession('2026-09-28')
    await refreshDay('2026-09-28', { today: TODAY })
    const created = (await row('2026-09-28'))?.createdAt
    await addSession('2026-09-28')
    await refreshDay('2026-09-28', { today: TODAY })
    expect(await row('2026-09-28')).toMatchObject({ focusSessions: 2, createdAt: created })

    await db.sessions.clear()
    const result = await refreshDay('2026-09-28', { today: TODAY })
    expect(result).toEqual({ written: 0, removed: 1 })
    expect(await row('2026-09-28')).toBeUndefined()
  })

  it('un-counts a finished task that was reopened', async () => {
    const task = await createTask({ title: 'Practice quiz' }, { now: NOW })
    await completeTask(task.id, { now: NOW })
    await refreshDay(TODAY, { today: TODAY })
    expect((await row(TODAY))?.tasksDone).toBe(1)
    await uncompleteTask(task.id, { now: NOW })
    await refreshDay(TODAY, { today: TODAY })
    // Completion XP was reversed to zero net too, so nothing is left to keep the row.
    expect(await row(TODAY)).toBeUndefined()
  })

  it('snapshots the goal: past days keep their target, today follows the setting', async () => {
    for (let i = 0; i < 3; i++) await addSession('2026-09-28')
    for (let i = 0; i < 3; i++) await addSession(TODAY)
    await rebuildDays('2026-09-28', TODAY, { today: TODAY })
    expect(await row('2026-09-28')).toMatchObject({ dailyGoalTarget: 3, dailyGoalHit: true })
    expect(await row(TODAY)).toMatchObject({ dailyGoalTarget: 3, dailyGoalHit: true })

    await updateSettings({ dailyGoalPomodoros: 6 })
    await rebuildDays('2026-09-28', TODAY, { today: TODAY })
    expect(await row('2026-09-28')).toMatchObject({ dailyGoalTarget: 3, dailyGoalHit: true })
    expect(await row(TODAY)).toMatchObject({ dailyGoalTarget: 6, dailyGoalHit: false })
    // Three sessions still qualify today: the goal is only one way in.
    expect((await row(TODAY))?.qualified).toBe(true)
  })

  it('does nothing for an empty or backwards range', async () => {
    await addSession('2026-09-28')
    expect(await rebuildDays('2026-09-29', '2026-09-28', { today: TODAY })).toEqual({
      written: 0,
      removed: 0,
    })
    expect(await db.streakDays.count()).toBe(0)
  })
})

describe('needsFullRebuild and rebuildAll', () => {
  it('is false for an empty database', async () => {
    expect(await needsFullRebuild()).toBe(false)
    expect(await rebuildAll({ today: TODAY })).toEqual({ written: 0, removed: 0 })
  })

  it('is true when there is history but no rows, and false once rebuilt', async () => {
    await addRun('2026-09-28', 5)
    expect(await needsFullRebuild()).toBe(true)
    const result = await rebuildAll({ today: TODAY })
    expect(result.written).toBe(5)
    expect(await needsFullRebuild()).toBe(false)
  })

  it('is true when older history turns up than the oldest row (an import)', async () => {
    await addSession('2026-09-28')
    await rebuildAll({ today: TODAY })
    expect(await needsFullRebuild()).toBe(false)
    await addSession('2026-08-15')
    expect(await needsFullRebuild()).toBe(true)
    await rebuildAll({ today: TODAY })
    expect(await row('2026-08-15')).toMatchObject({ qualified: true })
  })

  it('is true when a stored row has an older shape, and the rebuild replaces it', async () => {
    await addSession('2026-09-28')
    await db.streakDays.put({
      id: '2026-09-28',
      day: '2026-09-28',
      qualified: true,
    } as unknown as StreakDay)
    expect(await needsFullRebuild()).toBe(true)
    await rebuildAll({ today: TODAY })
    expect(await row('2026-09-28')).toMatchObject({ focusSessions: 1, focusMinutes: 25 })
    expect(await needsFullRebuild()).toBe(false)
  })

  it('ignores sessions that never counted', async () => {
    await addSession('2026-09-01', { counted: false })
    await addSession('2026-09-28')
    await rebuildAll({ today: TODAY })
    expect(await needsFullRebuild()).toBe(false)
    expect(await db.streakDays.count()).toBe(1)
  })
})

describe('syncProgressAtStart', () => {
  it('builds everything the first time and credits the badges the rows earn, in the same transaction', async () => {
    await addRun('2026-09-28', 8)
    const first = await syncProgressAtStart({ today: TODAY, now: NOW })
    expect(first).toMatchObject({ full: true, written: 8, removed: 0 })
    expect((await getBadges()).map((b) => b.id)).toEqual(
      expect.arrayContaining(['first-focus', 'streak-7']),
    )
  })

  it('later starts only recompute the last three days', async () => {
    await addSession('2026-09-20')
    await syncProgressAtStart({ today: TODAY, now: NOW })
    await addSession('2026-09-26')
    await addSession('2026-09-28')
    const again = await syncProgressAtStart({ today: TODAY, now: NOW })
    expect(again).toMatchObject({ full: false, written: 1, removed: 0 }) // the 28th; the 26th is out of reach
    expect(await row('2026-09-26')).toBeUndefined()
    expect(await row('2026-09-28')).toMatchObject({ qualified: true })

    const quiet = await syncProgressAtStart({ today: TODAY, now: NOW })
    expect(quiet).toMatchObject({ full: false, written: 0, removed: 0 })
  })
})

describe('loadStreak', () => {
  it('reads the rows and applies the weekly freeze', async () => {
    // Fri, Sat, (Sun off), Mon: the freeze covers Sunday.
    for (const day of ['2026-09-25', '2026-09-26', '2026-09-28']) await addSession(day)
    await rebuildAll({ today: TODAY })
    const streak = await loadStreak(TODAY)
    expect(streak.current).toBe(3)
    expect(streak.days.find((d) => d.day === '2026-09-27')?.status).toBe('frozen')
    expect(streak.freezeAvailableThisWeek).toBe(true)
  })

  it('follows weekStartsOn', async () => {
    // Sat and Sun off: one freeze each with Sunday-first weeks, only one with Monday-first.
    for (const day of ['2026-09-25', '2026-09-28']) await addSession(day)
    await rebuildAll({ today: TODAY })
    expect((await loadStreak(TODAY)).current).toBe(1)
    await updateSettings({ weekStartsOn: 0 })
    expect((await loadStreak(TODAY)).current).toBe(2)
  })
})

describe('reconcileStreakMilestones', () => {
  async function build(last: ISODate, days: number): Promise<void> {
    await addRun(last, days)
    await rebuildAll({ today: last })
  }

  it('pays 100 XP once at 7 days, dated to the day it was reached', async () => {
    await build(TODAY, 7)
    const awards = await reconcileStreakMilestones(TODAY)
    expect(awards).toHaveLength(1)
    expect(awards[0]).toMatchObject({
      xp: 100,
      milestone: { days: 7, on: TODAY, key: 'streak:7:2026-09-23' },
    })
    expect(awards[0]?.event).toMatchObject({
      source: 'streak',
      amount: 100,
      key: 'streak:7:2026-09-23',
      day: TODAY,
    })
    expect(await xpNetForKey('streak:7:2026-09-23')).toBe(100)

    expect(await reconcileStreakMilestones(TODAY)).toEqual([])
    expect(await xpNetForKey('streak:7:2026-09-23')).toBe(100)
  })

  it('pays nothing at six days, and the same key never pays twice as the streak grows', async () => {
    await build('2026-09-28', 6)
    expect(await reconcileStreakMilestones('2026-09-28')).toEqual([])

    await addSession(TODAY)
    await rebuildDays(TODAY, TODAY, { today: TODAY })
    expect(await reconcileStreakMilestones(TODAY)).toHaveLength(1)

    await addSession(addDays(TODAY, 1))
    await rebuildDays(addDays(TODAY, 1), addDays(TODAY, 1), { today: addDays(TODAY, 1) })
    expect(await reconcileStreakMilestones(addDays(TODAY, 1))).toEqual([])
    expect((await db.xpEvents.where('source').equals('streak').toArray()).length).toBe(1)
  })

  it('pays 500 at 30 days on top of the 100 for day 7, each once', async () => {
    await build(TODAY, 30)
    const awards = await reconcileStreakMilestones(TODAY)
    expect(awards.map((a) => [a.milestone.days, a.xp])).toEqual([
      [7, 100],
      [30, 500],
    ])
    const total = (await db.xpEvents.where('source').equals('streak').toArray()).reduce(
      (sum, e) => sum + e.amount,
      0,
    )
    expect(total).toBe(600)
  })

  it('gives a streak that started again its own milestone', async () => {
    // 7 days, three days off, 7 more.
    await addRun('2026-09-10', 7)
    await addRun(TODAY, 7)
    await rebuildAll({ today: TODAY })
    const awards = await reconcileStreakMilestones(TODAY)
    expect(awards.map((a) => a.milestone.key)).toEqual([
      'streak:7:2026-09-04',
      'streak:7:2026-09-23',
    ])
  })

  it('counts the freeze: a covered day does not add to the milestone', async () => {
    // Mon 21 to Sat 26 qualify, then Sunday and Monday are off (each week has its freeze), then Tuesday
    // is the 7th qualifying day: the milestone falls on the 9th calendar day, not the 7th.
    await addRun('2026-09-26', 6)
    await addSession(TODAY)
    await rebuildAll({ today: TODAY })
    const streak = await loadStreak(TODAY)
    expect(streak.current).toBe(7)
    const awards = await reconcileStreakMilestones(TODAY)
    expect(awards[0]?.milestone).toMatchObject({ days: 7, on: TODAY })
  })
})
