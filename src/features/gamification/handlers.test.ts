import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Tests clear the fake database directly; the lint rule keeps app code on repos and queries.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { db } from '@/db/db'
import { resetDomainEvents, settleDomainEvents, subscribe } from '@/db/events'
import { finishSession, startSession } from '@/db/repos/sessions'
import { ensureSettings, getSettings, updateSettings } from '@/db/repos/settings'
import { getXpSummary } from '@/db/repos/xp'
import { xpToReachLevel } from '@/logic/xp'
import { dailyGoalHandler, gamificationAppStart, rememberStartingLevel } from './handlers'

const MIN = 60_000
const T0 = new Date(2026, 8, 29, 9, 30).getTime()
const TODAY = '2026-09-29'

beforeEach(async () => {
  resetDomainEvents()
  await Promise.all(db.tables.map((t) => t.clear()))
  await ensureSettings()
  await updateSettings({ dailyGoalPomodoros: 2 })
  subscribe(dailyGoalHandler)
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

/** A full 25-minute pomodoro that starts at `start` and is finished at its planned end. */
async function pomodoro(start: number): Promise<void> {
  const session = await startSession(
    { mode: 'pomodoro', kind: 'focus', plannedMin: 25 },
    { now: start },
  )
  await finishSession(session.id, { now: start + 25 * MIN })
  await settleDomainEvents()
}

const dailyGoalRows = () => db.xpEvents.where('source').equals('dailyGoal').toArray()

describe('daily goal handler (session.ended)', () => {
  it('pays +25 XP when the session that ends is the one that reaches the goal', async () => {
    await pomodoro(T0)
    expect(await dailyGoalRows()).toEqual([])
    await pomodoro(T0 + 30 * MIN)
    const rows = await dailyGoalRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ amount: 25, key: `dailyGoal:${TODAY}`, day: TODAY })
    // 2 × 25 focus minutes + the bonus.
    expect((await getXpSummary(TODAY)).lifetime).toBe(50 + 25)
  })

  it('pays once a day, however many sessions follow', async () => {
    await pomodoro(T0)
    await pomodoro(T0 + 30 * MIN)
    await pomodoro(T0 + 60 * MIN)
    await pomodoro(T0 + 90 * MIN)
    expect(await dailyGoalRows()).toHaveLength(1)
  })

  it('ignores a session that did not count', async () => {
    await updateSettings({ dailyGoalPomodoros: 1 })
    const session = await startSession(
      { mode: 'pomodoro', kind: 'focus', plannedMin: 25 },
      { now: T0 },
    )
    // Stopped at 10 of 25 minutes: under 80%, so it is not a pomodoro.
    await finishSession(session.id, { now: T0 + 10 * MIN, interrupted: true })
    await settleDomainEvents()
    expect(await dailyGoalRows()).toEqual([])
  })

  it('awards nothing for a break', async () => {
    await updateSettings({ dailyGoalPomodoros: 1 })
    const session = await startSession(
      { mode: 'pomodoro', kind: 'break', plannedMin: 5 },
      { now: T0 },
    )
    await finishSession(session.id, { now: T0 + 5 * MIN })
    await settleDomainEvents()
    expect(await dailyGoalRows()).toEqual([])
  })
})

describe('start-up (onAppStart)', () => {
  it('reconciles a goal reached while no tab was open', async () => {
    // Finish two sessions with the handler off, as if the app had been closed.
    resetDomainEvents()
    await pomodoro(T0)
    await pomodoro(T0 + 30 * MIN)
    expect(await dailyGoalRows()).toEqual([])
    await gamificationAppStart({ today: TODAY })
    expect(await dailyGoalRows()).toHaveLength(1)
    await gamificationAppStart({ today: TODAY })
    expect(await dailyGoalRows()).toHaveLength(1)
  })

  it('records the level the app opens at, without celebrating it', async () => {
    await db.xpEvents.add({
      id: 'x1',
      createdAt: T0,
      updatedAt: T0,
      at: T0,
      day: TODAY,
      source: 'adjustment',
      amount: xpToReachLevel(5) + 40,
      key: 'seed',
      refId: null,
      note: null,
    })
    expect((await getSettings()).lastCelebratedLevel).toBe(0)
    await rememberStartingLevel(TODAY)
    expect((await getSettings()).lastCelebratedLevel).toBe(5)
    // Later starts leave it alone: a level earned since is the watcher's to celebrate.
    await db.xpEvents.add({
      id: 'x2',
      createdAt: T0,
      updatedAt: T0,
      at: T0,
      day: TODAY,
      source: 'adjustment',
      amount: 5000,
      key: 'more',
      refId: null,
      note: null,
    })
    await rememberStartingLevel(TODAY)
    expect((await getSettings()).lastCelebratedLevel).toBe(5)
  })
})
