import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Tests clear the fake database directly; the lint rule keeps app code on repos and queries.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { db } from '@/db/db'
import { emit, resetDomainEvents, settleDomainEvents, subscribeAll } from '@/db/events'
import { getBadges } from '@/db/repos/badges'
import { loadStreak, type StreakMilestoneAward } from '@/db/repos/progress'
import { finishSession, startSession } from '@/db/repos/sessions'
import { ensureSettings, updateSettings } from '@/db/repos/settings'
import { completeTask, createTask, uncompleteTask } from '@/db/repos/tasks'
import { awardXp } from '@/db/repos/xp'
import type { ISODate, Session } from '@/db/types'
import { addDays } from '@/logic/dates'
import {
  forgetVerifiedStart,
  onStreakMilestones,
  streakDomainHandlers,
  streaksAppStart,
} from './handlers'

const MIN = 60_000
const TODAY = '2026-09-29' // a Tuesday
const T0 = new Date(2026, 8, 29, 9, 30).getTime()

let seq = 0
async function addSession(day: ISODate): Promise<void> {
  seq += 1
  const startedAt = new Date(`${day}T08:00:00`).getTime() + seq * MIN
  const row: Session = {
    id: `h${seq}`,
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
    endedAt: startedAt + 25 * MIN,
    plannedMinutes: 25,
    pausedMs: 0,
    pausedAt: null,
    actualMinutes: 25,
    round: seq,
    interrupted: false,
    counted: true,
    note: null,
  }
  await db.sessions.add(row)
}

/** A full 25-minute pomodoro through the real repo, so `session.ended` fires like it does in the app. */
async function pomodoro(start: number, planned = 25, actual = 25): Promise<void> {
  const session = await startSession(
    { mode: 'pomodoro', kind: 'focus', plannedMin: planned },
    { now: start },
  )
  await finishSession(session.id, { now: start + actual * MIN })
  await settleDomainEvents()
}

const streakXp = () => db.xpEvents.where('source').equals('streak').toArray()

let announced: StreakMilestoneAward[] = []
let stopListening = (): void => {}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: T0 })
  resetDomainEvents()
  forgetVerifiedStart()
  await Promise.all(db.tables.map((t) => t.clear()))
  await ensureSettings()
  await updateSettings({ dailyGoalPomodoros: 4, weekStartsOn: 1 })
  subscribeAll(streakDomainHandlers)
  announced = []
  stopListening = onStreakMilestones((awards) => announced.push(...awards))
})

afterEach(async () => {
  await settleDomainEvents()
  stopListening()
  resetDomainEvents()
  vi.useRealTimers()
})

describe('session.ended', () => {
  it('writes the day’s row when a session counts', async () => {
    await pomodoro(T0)
    expect(await db.streakDays.get(TODAY)).toMatchObject({
      focusSessions: 1,
      focusMinutes: 25,
      pomodoros: 1,
      qualified: true,
      xp: 25,
    })
    expect((await loadStreak(TODAY)).current).toBe(1)
  })

  it('writes nothing for a session that did not count', async () => {
    // Stopped at 10 of 25 minutes: under the 80% rule.
    await pomodoro(T0, 25, 10)
    expect(await db.streakDays.get(TODAY)).toBeUndefined()
  })

  it('pays 100 XP and announces it when the session makes the 7th day', async () => {
    for (let i = 1; i <= 6; i++) await addSession(addDays(TODAY, -i))
    await streaksAppStart({ now: T0, today: TODAY })
    expect((await loadStreak(TODAY)).current).toBe(6)
    expect(announced).toEqual([])

    await pomodoro(T0)
    expect((await loadStreak(TODAY)).current).toBe(7)
    const paid = await streakXp()
    expect(paid).toHaveLength(1)
    expect(paid[0]).toMatchObject({ amount: 100, key: 'streak:7:2026-09-23', day: TODAY })
    expect(announced.map((a) => [a.milestone.days, a.xp])).toEqual([[7, 100]])
    // The milestone's XP is on the day's row too.
    expect((await db.streakDays.get(TODAY))?.xp).toBe(25 + 100)
  })

  it('announces a milestone once, however many more sessions follow', async () => {
    for (let i = 1; i <= 6; i++) await addSession(addDays(TODAY, -i))
    await streaksAppStart({ now: T0, today: TODAY })
    await pomodoro(T0)
    await pomodoro(T0 + 40 * MIN)
    await pomodoro(T0 + 80 * MIN)
    expect(announced).toHaveLength(1)
    expect(await streakXp()).toHaveLength(1)
  })
})

describe('task and XP events', () => {
  it('counts a finished task on its day, and takes it back on reopen', async () => {
    const task = await createTask({ title: 'Finish C182 unit 3 review' }, { now: T0 })
    await completeTask(task.id, { now: T0 })
    await settleDomainEvents()
    expect(await db.streakDays.get(TODAY)).toMatchObject({ tasksDone: 1, qualified: false })
    expect((await db.streakDays.get(TODAY))?.xp).toBeGreaterThan(0)

    await uncompleteTask(task.id, { now: T0 })
    await settleDomainEvents()
    expect(await db.streakDays.get(TODAY)).toBeUndefined()
  })

  it('keeps the day’s XP current when XP arrives without a session or task event', async () => {
    await addSession(TODAY)
    await streaksAppStart({ now: T0, today: TODAY })
    await awardXp({ source: 'ritual', amount: 10, key: 'ritual:test', day: TODAY })
    await settleDomainEvents()
    expect((await db.streakDays.get(TODAY))?.xp).toBe(10)
  })
})

describe('settings.changed', () => {
  it('re-reads today’s goal, and leaves past days at the goal they had', async () => {
    for (let i = 0; i < 4; i++) await addSession(TODAY)
    for (let i = 0; i < 4; i++) await addSession(addDays(TODAY, -1))
    await streaksAppStart({ now: T0, today: TODAY })
    expect(await db.streakDays.get(TODAY)).toMatchObject({ dailyGoalTarget: 4, dailyGoalHit: true })

    await updateSettings({ dailyGoalPomodoros: 6 })
    await settleDomainEvents()
    expect(await db.streakDays.get(TODAY)).toMatchObject({
      dailyGoalTarget: 6,
      dailyGoalHit: false,
    })
    expect(await db.streakDays.get(addDays(TODAY, -1))).toMatchObject({
      dailyGoalTarget: 4,
      dailyGoalHit: true,
    })
  })
})

describe('streaksAppStart', () => {
  it('builds the whole history the first time, and credits milestones and badges quietly', async () => {
    for (let i = 0; i < 8; i++) await addSession(addDays(TODAY, -i))
    expect(await db.streakDays.count()).toBe(0)

    await streaksAppStart({ now: T0, today: TODAY })
    expect(await db.streakDays.count()).toBe(8)
    expect((await loadStreak(TODAY)).current).toBe(8)
    expect(await streakXp()).toHaveLength(1)
    expect(announced).toEqual([]) // history is never news
    expect((await getBadges()).map((b) => b.id)).toEqual(
      expect.arrayContaining(['first-focus', 'streak-7']),
    )
  })

  it('recomputes the last three days on later starts', async () => {
    await addSession(addDays(TODAY, -5))
    await streaksAppStart({ now: T0, today: TODAY })
    expect(await db.streakDays.count()).toBe(1)

    // A session that ended while no tab was open: no event reached any handler.
    await addSession(addDays(TODAY, -1))
    await addSession(TODAY)
    await streaksAppStart({ now: T0, today: TODAY })
    expect(await db.streakDays.count()).toBe(3)
  })

  it('checks the whole cache on the first start of a page load, so a raw write is picked up', async () => {
    const old = addDays(TODAY, -10)
    await addSession(old)
    await streaksAppStart({ now: T0, today: TODAY })
    // A second session appears on that day without any event (an import, a sync, a raw write).
    await addSession(old)
    await streaksAppStart({ now: T0, today: TODAY }) // a later start: only the last three days
    expect((await db.streakDays.get(old))?.focusSessions).toBe(1)

    forgetVerifiedStart() // a fresh page load
    await streaksAppStart({ now: T0, today: TODAY })
    expect((await db.streakDays.get(old))?.focusSessions).toBe(2)
  })

  it('is safe to run again and again', async () => {
    for (let i = 0; i < 7; i++) await addSession(addDays(TODAY, -i))
    await streaksAppStart({ now: T0, today: TODAY })
    await settleDomainEvents() // the milestone's XP reaches the day's row through xp.changed
    const rows = await db.streakDays.toArray()
    expect(rows.find((r) => r.day === TODAY)?.xp).toBe(100)
    await streaksAppStart({ now: T0, today: TODAY })
    await streaksAppStart({ now: T0, today: TODAY })
    await settleDomainEvents()
    expect(await db.streakDays.toArray()).toEqual(rows)
    expect(await streakXp()).toHaveLength(1)
  })
})

describe('sync.applied', () => {
  it('rebuilds the streak rows from the synced history, and announces and pays nothing for it', async () => {
    // Eight days of work done on another device arrived as plain rows: no event ran for any of it.
    for (let i = 0; i < 8; i++) await addSession(addDays(TODAY, -i))
    expect(await db.streakDays.count()).toBe(0)

    emit({ type: 'sync.applied', tables: ['sessions'], goalIds: [] })
    await settleDomainEvents()

    expect(await db.streakDays.count()).toBe(8)
    expect((await loadStreak(TODAY)).current).toBe(8)
    // No milestone XP for work done elsewhere (the other device pays its own, and it syncs), no toast.
    expect(await streakXp()).toEqual([])
    expect(announced).toEqual([])
    // The badges those days earn are credited in the same quiet transaction.
    expect((await getBadges()).map((b) => b.id)).toEqual(
      expect.arrayContaining(['first-focus', 'streak-7']),
    )
  })

  it('takes back a day whose sessions were deleted elsewhere', async () => {
    await addSession(TODAY)
    await streaksAppStart({ now: T0, today: TODAY })
    expect(await db.streakDays.count()).toBe(1)
    await db.sessions.clear()
    emit({ type: 'sync.applied', tables: ['sessions'], goalIds: [] })
    await settleDomainEvents()
    expect(await db.streakDays.count()).toBe(0)
  })

  it('ignores a sync that changed nothing a day is built from', async () => {
    await addSession(TODAY)
    emit({ type: 'sync.applied', tables: ['rewards', 'flashcards'], goalIds: [] })
    await settleDomainEvents()
    expect(await db.streakDays.count()).toBe(0)
  })
})
