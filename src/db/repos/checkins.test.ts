import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import {
  getCheckInForSession,
  listCheckIns,
  refreshBestHour,
  saveCheckIn,
} from '@/db/repos/checkins'
import { loadGoalRows } from '@/db/repos/planning'
import { ensureSettings, getSettings } from '@/db/repos/settings'
import type { Session } from '@/db/types'
import { dayOf } from '@/logic/dates'
import { goalRow } from '@/logic/scheduler/fixtures'

const MIN = 60_000
/** Tue 2026-09-29 at the given local hour and minute. */
const at = (hour: number, minute = 0, day = 29): number =>
  new Date(2026, 8, day, hour, minute).getTime()

let seq = 0

/** A finished 25-minute focus session that started at `startedAt`. */
async function session(startedAt: number): Promise<Session> {
  const row: Session = {
    id: `s${++seq}`,
    createdAt: startedAt,
    updatedAt: startedAt + 25 * MIN,
    kind: 'focus',
    mode: 'pomodoro',
    status: 'completed',
    taskId: null,
    goalId: null,
    milestoneId: null,
    day: dayOf(startedAt),
    startedAt,
    endedAt: startedAt + 25 * MIN,
    plannedMinutes: 25,
    pausedMs: 0,
    pausedAt: null,
    actualMinutes: 25,
    round: 1,
    interrupted: false,
    counted: true,
    note: null,
  }
  await db.sessions.add(row)
  return row
}

beforeEach(async () => {
  seq = 0
  await Promise.all(db.tables.map((t) => t.clear()))
  await ensureSettings()
})

describe('saveCheckIn', () => {
  it('stamps the check-in with when the session began, not when it was rated', async () => {
    // Started 9:50 on a Tuesday, rated at 10:20.
    const s = await session(at(9, 50))
    const saved = await saveCheckIn({ sessionId: s.id, focus: 4, mood: '🙂' }, { now: at(10, 20) })
    expect(saved).toMatchObject({
      sessionId: s.id,
      at: at(10, 20),
      day: '2026-09-29',
      hour: 9,
      weekday: 2,
      focus: 4,
      mood: '🙂',
    })
    expect(await getCheckInForSession(s.id)).toEqual(saved)
  })

  it('reads a Sunday as weekday 0', async () => {
    const s = await session(at(20, 0, 27))
    const saved = await saveCheckIn({ sessionId: s.id, focus: 3 })
    expect(saved.weekday).toBe(0)
    expect(saved.day).toBe('2026-09-27')
  })

  it('keeps the day a late session began on when it is rated after midnight', async () => {
    const s = await session(at(23, 50))
    const saved = await saveCheckIn({ sessionId: s.id, focus: 5 }, { now: at(24, 20) })
    expect(saved).toMatchObject({ day: '2026-09-29', hour: 23, weekday: 2 })
  })

  it('has no mood unless one is given, and blank means none', async () => {
    const s = await session(at(9))
    expect((await saveCheckIn({ sessionId: s.id, focus: 2 })).mood).toBeNull()
    expect((await saveCheckIn({ sessionId: s.id, focus: 2, mood: '  ' })).mood).toBeNull()
  })

  it('rating a session again replaces its check-in instead of adding one', async () => {
    const s = await session(at(9))
    const first = await saveCheckIn({ sessionId: s.id, focus: 3 }, { now: at(9, 30) })
    const second = await saveCheckIn({ sessionId: s.id, focus: 5, mood: '😌' }, { now: at(9, 31) })
    expect(second.id).toBe(first.id)
    expect(second).toMatchObject({ focus: 5, mood: '😌', at: first.at, hour: 9 })
    expect(await db.checkIns.count()).toBe(1)
  })

  it('accepts a check-in with no session, stamped with now', async () => {
    const saved = await saveCheckIn({ sessionId: null, focus: 4 }, { now: at(14, 5) })
    expect(saved).toMatchObject({ sessionId: null, hour: 14, weekday: 2, day: '2026-09-29' })
  })

  it('refuses a rating outside 1 to 5', async () => {
    const s = await session(at(9))
    await expect(saveCheckIn({ sessionId: s.id, focus: 0 as never })).rejects.toBeInstanceOf(
      RangeError,
    )
    await expect(saveCheckIn({ sessionId: s.id, focus: 6 as never })).rejects.toBeInstanceOf(
      RangeError,
    )
    await expect(saveCheckIn({ sessionId: s.id, focus: 3.5 as never })).rejects.toBeInstanceOf(
      RangeError,
    )
    expect(await db.checkIns.count()).toBe(0)
  })
})

describe('the best hour', () => {
  it('stays null until an hour has three ratings, then follows the top hour', async () => {
    expect((await getSettings()).scheduling.bestHour).toBeNull()

    for (let day = 21; day <= 22; day++) {
      const s = await session(at(9, 0, day))
      await saveCheckIn({ sessionId: s.id, focus: 5 })
    }
    expect((await getSettings()).scheduling.bestHour).toBeNull()

    const third = await session(at(9, 10, 23))
    await saveCheckIn({ sessionId: third.id, focus: 4 })
    expect((await getSettings()).scheduling.bestHour).toBe(9)

    // Three better ratings at 19:00 take over.
    for (let day = 24; day <= 26; day++) {
      const s = await session(at(19, 0, day))
      await saveCheckIn({ sessionId: s.id, focus: 5 })
    }
    expect((await getSettings()).scheduling.bestHour).toBe(19)
  })

  it('is recomputed when a rating changes', async () => {
    const nine: Session[] = []
    for (let day = 21; day <= 23; day++) nine.push(await session(at(9, 0, day)))
    const evening: Session[] = []
    for (let day = 21; day <= 23; day++) evening.push(await session(at(20, 0, day)))
    for (const s of nine) await saveCheckIn({ sessionId: s.id, focus: 4 })
    for (const s of evening) await saveCheckIn({ sessionId: s.id, focus: 3 })
    expect((await getSettings()).scheduling.bestHour).toBe(9)

    // The evenings turn out better after all.
    for (const s of evening) await saveCheckIn({ sessionId: s.id, focus: 5 })
    expect((await getSettings()).scheduling.bestHour).toBe(20)
  })

  it('leaves the rest of the scheduling settings alone', async () => {
    const before = (await getSettings()).scheduling
    for (let day = 21; day <= 23; day++) {
      const s = await session(at(8, 0, day))
      await saveCheckIn({ sessionId: s.id, focus: 4 })
    }
    expect((await getSettings()).scheduling).toEqual({ ...before, bestHour: 8 })
  })

  it('can be refreshed on its own, e.g. after an import', async () => {
    await db.checkIns.bulkAdd(
      [21, 22, 23].map((day, i) => ({
        id: `c${i}`,
        createdAt: at(9, 0, day),
        updatedAt: at(9, 0, day),
        sessionId: null,
        at: at(9, 30, day),
        day: `2026-09-${day}`,
        hour: 16,
        weekday: 1,
        focus: 5 as const,
        mood: null,
      })),
    )
    expect((await getSettings()).scheduling.bestHour).toBeNull()
    expect(await refreshBestHour()).toBe(16)
    expect((await getSettings()).scheduling.bestHour).toBe(16)
  })
})

describe('listCheckIns', () => {
  it('lists every check-in, oldest first', async () => {
    const a = await session(at(9, 0, 22))
    const b = await session(at(9, 0, 21))
    await saveCheckIn({ sessionId: a.id, focus: 3 }, { now: at(9, 30, 22) })
    await saveCheckIn({ sessionId: b.id, focus: 4 }, { now: at(9, 30, 21) })
    expect((await listCheckIns()).map((c) => c.sessionId)).toEqual([b.id, a.id])
  })
})

describe('what the planner reads', () => {
  it('is the best hour as a preferred start, and nothing until there is one', async () => {
    const goal = goalRow()
    await db.goals.add(goal)
    expect((await loadGoalRows(goal.id, '2026-09-29'))?.preferredStartMinutes).toBeNull()

    for (let day = 21; day <= 23; day++) {
      const s = await session(at(19, 0, day))
      await saveCheckIn({ sessionId: s.id, focus: 5 })
    }
    expect((await loadGoalRows(goal.id, '2026-09-29'))?.preferredStartMinutes).toBe(19 * 60)
  })
})
