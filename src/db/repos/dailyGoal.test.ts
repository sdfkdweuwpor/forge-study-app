import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { onDomainEvent, resetDomainEvents, settleDomainEvents, type DomainEvent } from '@/db/events'
import {
  awardDailyGoal,
  countedPomodorosOn,
  dailyGoalKey,
  reconcileDailyGoal,
} from '@/db/repos/dailyGoal'
import { ensureSettings, updateSettings } from '@/db/repos/settings'
import type { ISODate, Session } from '@/db/types'
import { XP_DAILY_GOAL } from '@/logic/xp'

const TODAY = '2026-09-29'
const YESTERDAY = '2026-09-28'

let seq = 0

/** A finished focus session that started on `day`. */
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

async function addSessions(day: ISODate, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await addSession(day)
}

let xpEvents: DomainEvent[] = []

beforeEach(async () => {
  resetDomainEvents()
  xpEvents = []
  onDomainEvent('xp.changed', (e) => void xpEvents.push(e))
  await Promise.all(db.tables.map((t) => t.clear()))
  await ensureSettings()
  await updateSettings({ dailyGoalPomodoros: 3 })
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

const dailyGoalRows = () => db.xpEvents.where('source').equals('dailyGoal').toArray()

describe('countedPomodorosOn', () => {
  it('counts what the goal ring counts: counted, finished focus sessions of that day', async () => {
    await addSessions(TODAY, 2)
    await addSession(TODAY, { counted: false })
    await addSession(TODAY, { status: 'abandoned' })
    await addSession(TODAY, { kind: 'break' })
    await addSession(YESTERDAY)
    expect(await countedPomodorosOn(TODAY)).toBe(2)
    expect(await countedPomodorosOn(YESTERDAY)).toBe(1)
  })

  it('turns a long custom session into pomodoros of the configured length', async () => {
    await addSession(TODAY, { mode: 'custom', plannedMinutes: 50, actualMinutes: 55 })
    // 55 focused minutes = two whole 25-minute pomodoros.
    expect(await countedPomodorosOn(TODAY)).toBe(2)
  })
})

describe('awardDailyGoal', () => {
  it('pays nothing until the goal is reached', async () => {
    await addSessions(TODAY, 2)
    expect(await awardDailyGoal(TODAY)).toBeNull()
    expect(await dailyGoalRows()).toEqual([])
  })

  it('pays +25 XP under dailyGoal:<day> when the goal is reached, and says which day', async () => {
    await addSessions(TODAY, 3)
    const event = await awardDailyGoal(TODAY)
    expect(event).toMatchObject({
      source: 'dailyGoal',
      amount: XP_DAILY_GOAL,
      key: dailyGoalKey(TODAY),
      day: TODAY,
    })
    expect(dailyGoalKey(TODAY)).toBe('dailyGoal:2026-09-29')
    await settleDomainEvents()
    expect(xpEvents).toEqual([{ type: 'xp.changed', day: TODAY, source: 'dailyGoal', amount: 25 }])
  })

  it('is idempotent: reaching it again, or going past it, pays nothing more', async () => {
    await addSessions(TODAY, 3)
    await awardDailyGoal(TODAY)
    await addSessions(TODAY, 2)
    expect(await awardDailyGoal(TODAY)).toBeNull()
    expect(await awardDailyGoal(TODAY)).toBeNull()
    expect(await dailyGoalRows()).toHaveLength(1)
  })

  it('survives being attempted at the same moment (two tabs, or an event and a reconcile)', async () => {
    await addSessions(TODAY, 3)
    const results = await Promise.all([
      awardDailyGoal(TODAY),
      awardDailyGoal(TODAY),
      awardDailyGoal(TODAY),
    ])
    expect(results.filter((r) => r !== null)).toHaveLength(1)
    expect(await dailyGoalRows()).toHaveLength(1)
  })

  it('awards each day separately', async () => {
    await addSessions(YESTERDAY, 3)
    await addSessions(TODAY, 3)
    await awardDailyGoal(YESTERDAY)
    await awardDailyGoal(TODAY)
    const rows = await dailyGoalRows()
    expect(rows.map((r) => r.key).sort()).toEqual(['dailyGoal:2026-09-28', 'dailyGoal:2026-09-29'])
  })

  it('follows the goal in settings, as the ring does', async () => {
    await addSessions(TODAY, 2)
    expect(await awardDailyGoal(TODAY)).toBeNull()
    await updateSettings({ dailyGoalPomodoros: 2 })
    expect(await awardDailyGoal(TODAY)).not.toBeNull()
  })

  it('treats a goal below one as one', async () => {
    await updateSettings({ dailyGoalPomodoros: 0 })
    expect(await awardDailyGoal(TODAY)).toBeNull()
    await addSession(TODAY)
    expect(await awardDailyGoal(TODAY)).not.toBeNull()
  })
})

describe('reconcileDailyGoal', () => {
  it('pays a goal that was reached while no tab was open, for yesterday and today', async () => {
    await addSessions(YESTERDAY, 4)
    await addSessions(TODAY, 3)
    const awarded = await reconcileDailyGoal(TODAY)
    expect(awarded.map((e) => e.key)).toEqual(['dailyGoal:2026-09-28', 'dailyGoal:2026-09-29'])
    // Yesterday's XP is filed under yesterday.
    expect(awarded.map((e) => e.day)).toEqual([YESTERDAY, TODAY])
  })

  it('does not go further back than yesterday', async () => {
    await addSessions('2026-09-27', 3)
    expect(await reconcileDailyGoal(TODAY)).toEqual([])
  })

  it('is a no-op the second time', async () => {
    await addSessions(TODAY, 3)
    expect(await reconcileDailyGoal(TODAY)).toHaveLength(1)
    expect(await reconcileDailyGoal(TODAY)).toEqual([])
    expect(await dailyGoalRows()).toHaveLength(1)
  })

  it('does nothing on an empty database', async () => {
    expect(await reconcileDailyGoal(TODAY)).toEqual([])
  })
})
