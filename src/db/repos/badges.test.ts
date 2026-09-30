import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WGU_GOAL_ID, buildWguBsCs } from '@/data/sample/wguBsCs'
import { db } from '@/db/db'
import { resetDomainEvents, settleDomainEvents } from '@/db/events'
import { getBadges, reconcileBadges, watchStreakDays } from '@/db/repos/badges'
import type { BadgeId, ISODate, Millis, Session } from '@/db/types'
import { addDays, dayOf, dayStartMs } from '@/logic/dates'

const MIN = 60_000
const DAY = 24 * 60 * MIN
const NOW = new Date(2026, 8, 29, 9, 30).getTime() // Tue 2026-09-29 09:30 local
const TODAY = '2026-09-29'
const at = (d: number, h: number, m = 0): Millis => new Date(2026, 8, d, h, m).getTime()

let seq = 0
function sessionRow(start: Millis, minutes = 25, over: Partial<Session> = {}): Session {
  seq += 1
  return {
    id: `sess-${String(seq).padStart(3, '0')}`,
    createdAt: start,
    updatedAt: start,
    kind: 'focus',
    mode: 'pomodoro',
    status: 'completed',
    taskId: null,
    goalId: null,
    milestoneId: null,
    day: dayOf(start),
    startedAt: start,
    endedAt: start + minutes * MIN,
    plannedMinutes: minutes,
    pausedMs: 0,
    pausedAt: null,
    actualMinutes: minutes,
    round: 1,
    interrupted: false,
    counted: true,
    note: null,
    ...over,
  }
}

async function streakRows(from: ISODate, qualified: readonly boolean[]): Promise<void> {
  await db.streakDays.bulkAdd(
    qualified.map((q, i) => ({
      id: addDays(from, i),
      day: addDays(from, i),
      focusMinutes: q ? 25 : 0,
      focusSessions: q ? 1 : 0,
      pomodoros: q ? 1 : 0,
      tasksDone: 0,
      dailyGoalTarget: 4,
      dailyGoalHit: false,
      qualified: q,
      xp: 0,
    })),
  )
}

const stored = async (): Promise<string[]> => (await getBadges()).map((b) => b.id)

beforeEach(async () => {
  resetDomainEvents()
  seq = 0
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

describe('reconcileBadges', () => {
  it('inserts nothing when there is no history', async () => {
    expect(await reconcileBadges(NOW)).toEqual([])
    expect(await db.badges.count()).toBe(0)
  })

  it('unlocks from a counted session: the row has the id, the moment and a note', async () => {
    const early = sessionRow(at(29, 7, 30))
    await db.sessions.add(early)
    const fresh = await reconcileBadges(NOW)
    expect(fresh.map((b) => b.id)).toEqual(['first-focus', 'early-bird'])
    expect(await db.badges.get('early-bird')).toEqual({
      id: 'early-bird',
      unlockedAt: early.endedAt,
      context: 'Started at 07:30',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('ignores sessions that did not count, breaks and unfinished ones', async () => {
    await db.sessions.bulkAdd([
      sessionRow(at(29, 7, 30), 25, { counted: false }),
      sessionRow(at(29, 7, 30), 5, { kind: 'break' }),
      sessionRow(at(29, 7, 30), 25, { status: 'running', endedAt: null, counted: false }),
      sessionRow(at(29, 7, 30), 25, { status: 'abandoned', counted: false }),
    ])
    expect(await reconcileBadges(NOW)).toEqual([])
  })

  it('is idempotent: a second run inserts nothing and changes nothing', async () => {
    await db.sessions.add(sessionRow(at(29, 7, 30)))
    await reconcileBadges(NOW)
    const before = await db.badges.toArray()
    expect(await reconcileBadges(NOW + 60 * MIN)).toEqual([])
    expect(await db.badges.toArray()).toEqual(before)
  })

  it('two runs at once still store each badge exactly once', async () => {
    await db.sessions.add(sessionRow(at(29, 7, 30)))
    const [a, b] = await Promise.all([reconcileBadges(NOW), reconcileBadges(NOW)])
    expect(a.length + b.length).toBe(2)
    expect(await db.badges.count()).toBe(2)
  })

  it('never removes or moves a badge: the history can shrink and the date stays', async () => {
    const early = sessionRow(at(29, 7, 30))
    await db.sessions.add(early)
    await reconcileBadges(NOW)
    const before = await db.badges.get('early-bird')

    await db.sessions.clear()
    expect(await reconcileBadges(NOW + DAY)).toEqual([])
    expect(await db.badges.get('early-bird')).toEqual(before)

    // Older data arriving later (an import) does not move the stored date either.
    await db.sessions.add(sessionRow(at(1, 6, 30)))
    expect(await reconcileBadges(NOW + DAY)).toEqual([])
    expect((await db.badges.get('early-bird'))?.unlockedAt).toBe(early.endedAt)
  })

  it('adds later badges without touching the earlier ones', async () => {
    const first = sessionRow(at(29, 9, 0))
    await db.sessions.add(first)
    await reconcileBadges(NOW)
    expect(await stored()).toEqual(['first-focus'])

    const night = sessionRow(at(29, 22, 30))
    await db.sessions.add(night)
    const fresh = await reconcileBadges(at(29, 23, 0))
    expect(fresh.map((b) => b.id)).toEqual(['night-owl'])
    expect((await db.badges.get('first-focus'))?.unlockedAt).toBe(first.endedAt)
  })

  it('unlocks deep work on the 4th counted session of a day', async () => {
    await db.sessions.bulkAdd([9, 11, 13].map((h) => sessionRow(at(29, h))))
    expect((await reconcileBadges(NOW)).map((b) => b.id)).not.toContain('deep-work')
    const fourth = sessionRow(at(29, 15))
    await db.sessions.add(fourth)
    await reconcileBadges(NOW)
    expect((await db.badges.get('deep-work'))?.unlockedAt).toBe(fourth.endedAt)
  })

  it('unlocks first-course from a done course and term-complete when the whole term is done', async () => {
    const sample = buildWguBsCs(TODAY, NOW)
    await db.goals.add(sample.goal)
    await db.milestones.bulkAdd(sample.milestones)
    const fresh = await reconcileBadges(NOW)
    expect(fresh.map((b) => b.id)).toContain('first-course')
    expect(fresh.map((b) => b.id)).not.toContain('term-complete')
    expect((await db.badges.get('first-course'))?.context).toBe('C182')

    const done = at(29, 8)
    await db.milestones
      .where('goalId')
      .equals(WGU_GOAL_ID)
      .modify((c) => {
        if (c.status !== 'done') {
          c.status = 'done'
          c.completedAt = done
        }
      })
    const more = await reconcileBadges(NOW)
    expect(more.map((b) => b.id)).toEqual(['term-complete'])
    expect(more[0]?.unlockedAt).toBe(done)
    expect(more[0]?.context).toBe('Term 1')
  })

  it('unlocks streak badges from qualified streakDays rows', async () => {
    await streakRows(addDays(TODAY, -6), [true, true, true, true, true, true, true])
    const fresh = await reconcileBadges(NOW)
    expect(fresh.map((b) => b.id)).toEqual(['streak-7'])
    // No session sits behind those rows, so it is dated to the start of the day the run reached 7.
    expect(fresh[0]?.unlockedAt).toBe(dayStartMs(TODAY))
  })

  it('does not treat today, still open, as a break, and does not count it either', async () => {
    await streakRows(addDays(TODAY, -6), [true, true, true, true, true, true])
    expect(await reconcileBadges(NOW)).toEqual([])
  })

  it('unlocks comeback after a broken streak of 3 and 3 days again', async () => {
    await streakRows(addDays(TODAY, -6), [true, true, true, false, true, true, true])
    const fresh = await reconcileBadges(NOW)
    expect(fresh.map((b) => b.id)).toEqual(['comeback'])
  })
})

describe('getBadges', () => {
  it('returns badges oldest unlock first and leaves out ids this build does not know', async () => {
    await db.badges.bulkAdd([
      { id: 'night-owl', unlockedAt: 300, context: null },
      { id: 'first-focus', unlockedAt: 100, context: null },
      { id: 'speed-runner' as unknown as BadgeId, unlockedAt: 50, context: null },
    ])
    expect((await getBadges()).map((b) => b.id)).toEqual(['first-focus', 'night-owl'])
  })
})

describe('watchStreakDays', () => {
  it('ignores the first read and calls back when streak rows change', async () => {
    const onChange = vi.fn()
    const stop = watchStreakDays(onChange)
    await new Promise((r) => setTimeout(r, 50))
    expect(onChange).not.toHaveBeenCalled()

    await streakRows(TODAY, [true])
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    stop()

    const calls = onChange.mock.calls.length
    await streakRows(addDays(TODAY, 1), [true])
    await new Promise((r) => setTimeout(r, 50))
    expect(onChange.mock.calls.length).toBe(calls)
  })
})
