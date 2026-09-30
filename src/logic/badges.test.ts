import { describe, expect, it } from 'vitest'
import type { BadgeId, ISODate, Millis } from '@/db/types'
import { addDays, dayOf, dayStartMs } from './dates'
import {
  BADGES,
  computeStreakForBadges,
  evaluateBadges,
  badgeMeta,
  badgeStates,
  formatUnlockDate,
  isBadgeId,
  recentBadges,
  unlockMessages,
  unlockSummary,
  type BadgeCourseRow,
  type BadgeGoalRow,
  type BadgeInput,
  type BadgeSessionRow,
  type BadgeStreak,
  type BadgeStreakStatus,
  type BadgeUnlock,
} from './badges'

const MIN = 60_000

/** Local wall-clock time (the tests run in America/New_York). `month` is 1-based. */
const at = (y: number, month: number, d: number, h = 0, m = 0): Millis =>
  new Date(y, month - 1, d, h, m).getTime()

let nextId = 0
/** A counted, completed focus session that started at `start` and ran `minutes`. */
function session(
  start: Millis,
  minutes = 25,
  over: Partial<BadgeSessionRow> = {},
): BadgeSessionRow {
  nextId += 1
  return {
    id: `s${String(nextId).padStart(4, '0')}`,
    kind: 'focus',
    status: 'completed',
    counted: true,
    day: dayOf(start),
    startedAt: start,
    endedAt: start + minutes * MIN,
    actualMinutes: minutes,
    ...over,
  }
}

const NO_STREAK: BadgeStreak = { days: [] }

function input(over: Partial<BadgeInput> = {}): BadgeInput {
  return { sessions: [], courses: [], goals: [], streak: NO_STREAK, ...over }
}

const ids = (unlocks: readonly BadgeUnlock[]): BadgeId[] => unlocks.map((u) => u.id)
const find = (unlocks: readonly BadgeUnlock[], id: BadgeId): BadgeUnlock | undefined =>
  unlocks.find((u) => u.id === id)

function course(over: Partial<BadgeCourseRow> & { id: string }): BadgeCourseRow {
  return {
    goalId: 'g1',
    kind: 'course',
    code: null,
    title: 'A course',
    status: 'todo',
    termId: null,
    completedAt: null,
    updatedAt: 1,
    ...over,
  }
}

type Mark = 'q' | 'm' | 'f' | 'o'
const STATUS: Record<Mark, BadgeStreakStatus> = {
  q: 'qualified',
  m: 'missed',
  f: 'frozen',
  o: 'open',
}

/** Streak days starting at `start`, one mark per day: q qualified, m missed, f frozen, o open. */
function streakFrom(start: ISODate, marks: readonly Mark[]): BadgeStreak {
  return { days: marks.map((mark, i) => ({ day: addDays(start, i), status: STATUS[mark] })) }
}
const q = (n: number): Mark[] => Array.from({ length: n }, () => 'q')

describe('metadata', () => {
  it('lists the eleven badges of the brief, in its order', () => {
    expect(BADGES.map((b) => b.id)).toEqual([
      'first-focus',
      'early-bird',
      'night-owl',
      'streak-7',
      'streak-30',
      'streak-100',
      'deep-work',
      'first-course',
      'term-complete',
      'hours-100',
      'comeback',
    ])
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(11)
  })

  it('has a title, description, hint and one emoji for each', () => {
    for (const b of BADGES) {
      expect(b.title.length).toBeGreaterThan(2)
      expect(b.description.length).toBeGreaterThan(5)
      expect(b.hint.length).toBeGreaterThan(5)
      expect(b.icon).toMatch(/^\p{Extended_Pictographic}/u)
      expect(b.icon).not.toMatch(/[a-z]/i)
    }
  })

  it('keeps hints encouraging: an instruction, never a reproach', () => {
    for (const b of BADGES) {
      expect(b.hint).not.toMatch(
        /\b(miss|missed|lost|lose|fail|failed|behind|only|still|yet|never)\b/i,
      )
    }
    expect(badgeMeta('early-bird')?.hint).toBe('Start a session before 8 a.m.')
  })

  it('recognises known ids only', () => {
    expect(isBadgeId('comeback')).toBe(true)
    expect(isBadgeId('speed-runner')).toBe(false)
    expect(badgeMeta('speed-runner')).toBeUndefined()
  })
})

describe('evaluateBadges: nothing to go on', () => {
  it('unlocks nothing without history', () => {
    expect(evaluateBadges(input())).toEqual([])
  })
})

describe('only counted focus sessions count', () => {
  const early = at(2026, 9, 29, 7, 30)
  it('ignores uncounted, unfinished, abandoned and break sessions', () => {
    const unlocks = evaluateBadges(
      input({
        sessions: [
          session(early, 25, { counted: false }),
          session(early, 25, { status: 'abandoned' }),
          session(early, 25, { status: 'running', endedAt: null, actualMinutes: null }),
          session(early, 5, { kind: 'break' }),
        ],
      }),
    )
    expect(unlocks).toEqual([])
  })

  it('does not count an uncounted session toward deep work or 100 hours', () => {
    const day = at(2026, 9, 29, 9)
    const sessions = [
      session(day),
      session(day + 60 * MIN),
      session(day + 120 * MIN),
      session(day + 180 * MIN, 25, { counted: false }),
    ]
    expect(ids(evaluateBadges(input({ sessions })))).not.toContain('deep-work')

    const long = [
      session(at(2026, 1, 1, 12), 5999),
      session(at(2026, 1, 2, 12), 30, { counted: false }),
    ]
    expect(ids(evaluateBadges(input({ sessions: long })))).not.toContain('hours-100')
  })
})

describe('first-focus', () => {
  it('unlocks when the first counted session ends', () => {
    const start = at(2026, 9, 29, 9, 30)
    const first = find(evaluateBadges(input({ sessions: [session(start, 25)] })), 'first-focus')
    expect(first).toEqual({
      id: 'first-focus',
      unlockedAt: start + 25 * MIN,
      context: '25 min on Sep 29',
    })
  })

  it('stays at the first session however many follow', () => {
    const a = session(at(2026, 9, 29, 9), 25)
    const b = session(at(2026, 9, 30, 9), 25)
    const both = find(evaluateBadges(input({ sessions: [b, a] })), 'first-focus')
    expect(both?.unlockedAt).toBe(a.endedAt)
  })
})

describe('early-bird: started before 08:00 local', () => {
  const day = (h: number, m: number) => session(at(2026, 9, 29, h, m), 25)

  it('unlocks at 07:30, 07:59 and just after midnight', () => {
    for (const [h, m] of [
      [7, 30],
      [7, 59],
      [0, 5],
    ] as const) {
      expect(ids(evaluateBadges(input({ sessions: [day(h, m)] })))).toContain('early-bird')
    }
  })

  it('does not unlock at 08:00 or later', () => {
    for (const [h, m] of [
      [8, 0],
      [8, 1],
      [12, 0],
      [23, 59],
    ] as const) {
      expect(ids(evaluateBadges(input({ sessions: [day(h, m)] })))).not.toContain('early-bird')
    }
  })

  it('unlocks when the session ends, with the start time as context, and keeps the first one', () => {
    const first = day(7, 30)
    const later = session(at(2026, 10, 2, 6, 45), 25)
    const badge = find(evaluateBadges(input({ sessions: [later, first] })), 'early-bird')
    expect(badge).toEqual({
      id: 'early-bird',
      unlockedAt: first.endedAt,
      context: 'Started at 07:30',
    })
  })

  it('counts a session that starts before 8 even if it ends after', () => {
    const s = session(at(2026, 9, 29, 7, 50), 25)
    expect(find(evaluateBadges(input({ sessions: [s] })), 'early-bird')?.unlockedAt).toBe(
      at(2026, 9, 29, 8, 15),
    )
  })
})

describe('night-owl: started 22:00 to 03:59 local', () => {
  const start = (h: number, m: number) => session(at(2026, 9, 29, h, m), 25)

  it('unlocks from 22:00 through 03:59', () => {
    for (const [h, m] of [
      [22, 0],
      [23, 59],
      [0, 0],
      [3, 59],
    ] as const) {
      expect(ids(evaluateBadges(input({ sessions: [start(h, m)] })))).toContain('night-owl')
    }
  })

  it('does not unlock at 21:59 or from 04:00', () => {
    for (const [h, m] of [
      [21, 59],
      [4, 0],
      [7, 30],
      [20, 0],
    ] as const) {
      expect(ids(evaluateBadges(input({ sessions: [start(h, m)] })))).not.toContain('night-owl')
    }
  })

  it('reads local time, not UTC: 20:00 EDT is 00:00 UTC and is not night', () => {
    const s = session(new Date('2026-09-30T00:00:00Z').getTime(), 25)
    expect(dayOf(s.startedAt)).toBe('2026-09-29')
    expect(ids(evaluateBadges(input({ sessions: [s] })))).not.toContain('night-owl')
  })

  it('reads local time, not UTC: 07:30 EDT is 11:30 UTC and is early', () => {
    const s = session(new Date('2026-09-29T11:30:00Z').getTime(), 25)
    expect(ids(evaluateBadges(input({ sessions: [s] })))).toContain('early-bird')
  })

  it('a session that starts at 03:59 is both night owl and early bird', () => {
    const unlocks = evaluateBadges(input({ sessions: [start(3, 59)] }))
    expect(ids(unlocks)).toEqual(expect.arrayContaining(['night-owl', 'early-bird']))
  })
})

describe('clock badges across daylight saving time', () => {
  it('spring forward (Sun 2026-03-08): 01:59 EST and 03:00 EDT are both night, 04:00 EDT is not', () => {
    const before = new Date('2026-03-08T06:59:00Z').getTime() // 01:59 EST
    const after = new Date('2026-03-08T07:00:00Z').getTime() // 03:00 EDT (02:00 does not exist)
    const later = new Date('2026-03-08T08:00:00Z').getTime() // 04:00 EDT
    expect(ids(evaluateBadges(input({ sessions: [session(before)] })))).toContain('night-owl')
    expect(ids(evaluateBadges(input({ sessions: [session(after)] })))).toContain('night-owl')
    expect(ids(evaluateBadges(input({ sessions: [session(later)] })))).not.toContain('night-owl')
    expect(ids(evaluateBadges(input({ sessions: [session(later)] })))).toContain('early-bird')
  })

  it('spring forward: 07:30 local is early on the 23-hour day', () => {
    const s = session(at(2026, 3, 8, 7, 30))
    expect(dayOf(s.startedAt)).toBe('2026-03-08')
    expect(find(evaluateBadges(input({ sessions: [s] })), 'early-bird')?.context).toBe(
      'Started at 07:30',
    )
    expect(ids(evaluateBadges(input({ sessions: [session(at(2026, 3, 8, 8, 0))] })))).not.toContain(
      'early-bird',
    )
  })

  it('fall back (Sun 2026-11-01): both 01:30s are night owl sessions, and 07:30 is early', () => {
    const first = new Date('2026-11-01T05:30:00Z').getTime() // 01:30 EDT
    const second = new Date('2026-11-01T06:30:00Z').getTime() // 01:30 EST, an hour later
    for (const start of [first, second]) {
      expect(ids(evaluateBadges(input({ sessions: [session(start, 20)] })))).toContain('night-owl')
    }
    const early = session(at(2026, 11, 1, 7, 30))
    expect(ids(evaluateBadges(input({ sessions: [early] })))).toContain('early-bird')
  })

  it('deep work counts four sessions on a 23-hour day and on a 25-hour day', () => {
    for (const [m, d] of [
      [3, 8],
      [11, 1],
    ] as const) {
      const sessions = [0, 1, 2, 3].map((i) => session(at(2026, m, d, 8 + i * 3), 25))
      const badge = find(evaluateBadges(input({ sessions })), 'deep-work')
      expect(badge?.unlockedAt).toBe(sessions[3]?.endedAt)
    }
  })

  it('a session that crosses midnight belongs to the day it started on', () => {
    // Three sessions on the 29th, and a 23:50 start that runs into the 30th: still the 29th.
    const evening = [9, 12, 15].map((h) => session(at(2026, 9, 29, h), 25))
    const late = session(at(2026, 9, 29, 23, 50), 25)
    const badge = find(evaluateBadges(input({ sessions: [...evening, late] })), 'deep-work')
    expect(badge?.unlockedAt).toBe(at(2026, 9, 30, 0, 15))
    expect(badge?.context).toBe('4 sessions on Sep 29')
  })
})

describe('deep-work: 4 counted sessions in one local day', () => {
  const daySessions = (d: number, n: number) =>
    Array.from({ length: n }, (_, i) => session(at(2026, 9, d, 9 + i * 2), 25))

  it('needs four on the same day', () => {
    expect(ids(evaluateBadges(input({ sessions: daySessions(29, 3) })))).not.toContain('deep-work')
    expect(ids(evaluateBadges(input({ sessions: daySessions(29, 4) })))).toContain('deep-work')
  })

  it('does not add up across days', () => {
    const sessions = [...daySessions(28, 3), ...daySessions(29, 3), ...daySessions(30, 3)]
    expect(ids(evaluateBadges(input({ sessions })))).not.toContain('deep-work')
  })

  it('unlocks when the 4th session ends, not the 5th', () => {
    const sessions = daySessions(29, 5)
    expect(find(evaluateBadges(input({ sessions })), 'deep-work')?.unlockedAt).toBe(
      sessions[3]?.endedAt,
    )
  })

  it('picks the earliest day that reached four', () => {
    const later = daySessions(30, 4)
    const earlier = daySessions(29, 4)
    expect(
      find(evaluateBadges(input({ sessions: [...later, ...earlier] })), 'deep-work')?.unlockedAt,
    ).toBe(earlier[3]?.endedAt)
  })
})

describe('hours-100: 6,000 counted minutes', () => {
  const chunks = (n: number, minutes: number) =>
    Array.from({ length: n }, (_, i) => session(at(2026, 1, 1, 9) + i * 24 * 60 * MIN, minutes))

  it('does not unlock at 5,999 minutes', () => {
    const sessions = [...chunks(99, 60), session(at(2026, 6, 1, 9), 59)]
    expect(ids(evaluateBadges(input({ sessions })))).not.toContain('hours-100')
  })

  it('unlocks at the session that reaches 6,000, and not later', () => {
    const sessions = chunks(101, 60)
    const badge = find(evaluateBadges(input({ sessions })), 'hours-100')
    expect(badge?.unlockedAt).toBe(sessions[99]?.endedAt)
  })

  it('sums whole minutes across differing lengths', () => {
    const sessions = [
      session(at(2026, 1, 1, 9), 3000),
      session(at(2026, 2, 1, 9), 2999),
      session(at(2026, 3, 1, 9), 1),
    ]
    expect(find(evaluateBadges(input({ sessions })), 'hours-100')?.unlockedAt).toBe(
      sessions[2]?.endedAt,
    )
  })
})

describe('first-course and term-complete', () => {
  it('first-course needs a course with status done', () => {
    expect(
      ids(
        evaluateBadges(
          input({ courses: [course({ id: 'c1' }), course({ id: 'c2', status: 'active' })] }),
        ),
      ),
    ).not.toContain('first-course')
  })

  it('unlocks at the earliest completion, with the course code as context', () => {
    const courses = [
      course({ id: 'c1', code: 'D278', status: 'done', completedAt: at(2026, 9, 20, 15) }),
      course({ id: 'c2', code: 'C182', status: 'done', completedAt: at(2026, 9, 10, 15) }),
    ]
    expect(find(evaluateBadges(input({ courses })), 'first-course')).toEqual({
      id: 'first-course',
      unlockedAt: at(2026, 9, 10, 15),
      context: 'C182',
    })
  })

  it('falls back to the last edit when a done course has no completion stamp, and to the title when it has no code', () => {
    const courses = [course({ id: 'c1', title: 'Capstone', status: 'done', updatedAt: 12_345 })]
    expect(find(evaluateBadges(input({ courses })), 'first-course')).toMatchObject({
      unlockedAt: 12_345,
      context: 'Capstone',
    })
  })

  it('ignores generic milestones', () => {
    const courses = [course({ id: 'm1', kind: 'milestone', status: 'done', completedAt: 5 })]
    expect(evaluateBadges(input({ courses }))).toEqual([])
  })

  const goals: BadgeGoalRow[] = [
    {
      id: 'g1',
      terms: [
        { id: 't1', label: 'Term 1', start: '2026-07-01', end: '2026-12-31' },
        { id: 't2', label: 'Term 2', start: '2027-01-01', end: '2027-06-30' },
      ],
    },
  ]

  it('term-complete needs every course of the term done', () => {
    const courses = [
      course({ id: 'a', termId: 't1', status: 'done', completedAt: 100 }),
      course({ id: 'b', termId: 't1', status: 'active' }),
    ]
    expect(ids(evaluateBadges(input({ courses, goals })))).not.toContain('term-complete')
  })

  it('unlocks when the last course of the term is done, labelled with the term', () => {
    const courses = [
      course({ id: 'a', termId: 't1', status: 'done', completedAt: at(2026, 9, 10) }),
      course({ id: 'b', termId: 't1', status: 'done', completedAt: at(2026, 9, 25) }),
      course({ id: 'c', termId: 't2', status: 'todo' }),
    ]
    expect(find(evaluateBadges(input({ courses, goals })), 'term-complete')).toEqual({
      id: 'term-complete',
      unlockedAt: at(2026, 9, 25),
      context: 'Term 1',
    })
  })

  it('ignores courses with no term, other goals, generic milestones and empty terms', () => {
    const courses = [
      course({ id: 'a', termId: null, status: 'done', completedAt: 1 }),
      course({ id: 'b', termId: 't1', goalId: 'other', status: 'done', completedAt: 1 }),
      course({ id: 'c', termId: 't1', kind: 'milestone', status: 'done', completedAt: 1 }),
    ]
    expect(ids(evaluateBadges(input({ courses, goals })))).not.toContain('term-complete')
  })

  it('a term with one course is complete when that course is done', () => {
    const courses = [course({ id: 'a', termId: 't2', status: 'done', completedAt: 77 })]
    expect(find(evaluateBadges(input({ courses, goals })), 'term-complete')?.context).toBe('Term 2')
  })

  it('takes the earliest of several completed terms', () => {
    const courses = [
      course({ id: 'a', termId: 't2', status: 'done', completedAt: 900 }),
      course({ id: 'b', termId: 't1', status: 'done', completedAt: 500 }),
    ]
    expect(find(evaluateBadges(input({ courses, goals })), 'term-complete')).toMatchObject({
      unlockedAt: 500,
      context: 'Term 1',
    })
  })
})

describe('streak-7, streak-30 and streak-100', () => {
  const START = '2026-08-01'

  it('does not unlock one day short', () => {
    expect(ids(evaluateBadges(input({ streak: streakFrom(START, q(6)) })))).not.toContain(
      'streak-7',
    )
    expect(ids(evaluateBadges(input({ streak: streakFrom(START, q(29)) })))).not.toContain(
      'streak-30',
    )
    expect(ids(evaluateBadges(input({ streak: streakFrom(START, q(99)) })))).not.toContain(
      'streak-100',
    )
  })

  it('unlocks each at its own length, and the shorter ones with it', () => {
    const unlocks = evaluateBadges(input({ streak: streakFrom(START, q(100)) }))
    expect(ids(unlocks)).toEqual(expect.arrayContaining(['streak-7', 'streak-30', 'streak-100']))
    expect(find(unlocks, 'streak-7')?.context).toBe('Aug 1 – Aug 7')
    expect(find(unlocks, 'streak-30')?.context).toBe('Aug 1 – Aug 30')
    expect(find(unlocks, 'streak-100')?.context).toBe('Aug 1 – Nov 8')
  })

  it('unlocks at the first counted session that ended on the day the streak reached 7', () => {
    const day7 = addDays(START, 6)
    const first = session(dayStartMs(day7) + 9 * 60 * MIN, 25)
    const second = session(dayStartMs(day7) + 15 * 60 * MIN, 25)
    const unlocks = evaluateBadges(
      input({ sessions: [second, first], streak: streakFrom(START, q(7)) }),
    )
    expect(find(unlocks, 'streak-7')?.unlockedAt).toBe(first.endedAt)
  })

  it('falls back to the start of the day when the streak rows have no session behind them', () => {
    const unlocks = evaluateBadges(input({ streak: streakFrom(START, q(7)) }))
    expect(find(unlocks, 'streak-7')?.unlockedAt).toBe(dayStartMs('2026-08-07'))
  })

  it('that fallback is the local midnight, also on a daylight-saving day', () => {
    // 2026-03-08 is 23 hours long; its local midnight is 05:00 UTC.
    const unlocks = evaluateBadges(input({ streak: streakFrom('2026-03-02', q(7)) }))
    expect(find(unlocks, 'streak-7')?.unlockedAt).toBe(new Date('2026-03-08T05:00:00Z').getTime())
  })

  it('a missed day starts the count again', () => {
    const streak = streakFrom(START, [...q(6), 'm', ...q(6)])
    expect(ids(evaluateBadges(input({ streak })))).not.toContain('streak-7')
    expect(
      ids(evaluateBadges(input({ streak: streakFrom(START, [...q(6), 'm', ...q(7)]) }))),
    ).toContain('streak-7')
  })

  it('a day absent from the list counts as missed', () => {
    const streak: BadgeStreak = {
      days: [
        ...streakFrom(START, q(4)).days,
        ...streakFrom(addDays(START, 5), q(4)).days, // the 5th day is absent
      ],
    }
    expect(ids(evaluateBadges(input({ streak })))).not.toContain('streak-7')
  })

  it('a frozen day keeps the streak but does not add to it', () => {
    expect(
      ids(evaluateBadges(input({ streak: streakFrom(START, [...q(3), 'f', ...q(3)]) }))),
    ).not.toContain('streak-7')
    const seven = evaluateBadges(input({ streak: streakFrom(START, [...q(3), 'f', ...q(4)]) }))
    expect(find(seven, 'streak-7')?.unlockedAt).toBe(dayStartMs(addDays(START, 7)))
  })

  it('today still open does not end the streak or add to it', () => {
    expect(ids(evaluateBadges(input({ streak: streakFrom(START, [...q(6), 'o']) })))).not.toContain(
      'streak-7',
    )
    expect(ids(evaluateBadges(input({ streak: streakFrom(START, [...q(7), 'o']) })))).toContain(
      'streak-7',
    )
  })
})

describe('comeback', () => {
  const START = '2026-08-01'
  const comeback = (statuses: readonly Mark[]) =>
    find(evaluateBadges(input({ streak: streakFrom(START, statuses) })), 'comeback')

  it('unlocks on the third qualifying day after a broken streak of 3 or more', () => {
    const badge = comeback(['q', 'q', 'q', 'm', 'q', 'q', 'q'])
    expect(badge).toEqual({
      id: 'comeback',
      unlockedAt: dayStartMs('2026-08-07'),
      context: 'Back on Aug 7 after a break',
    })
  })

  it('needs the earlier streak to have reached 3', () => {
    expect(comeback(['q', 'q', 'm', 'q', 'q', 'q'])).toBeUndefined()
    expect(comeback(['q', 'm', 'q', 'q', 'q'])).toBeUndefined()
  })

  it('needs 3 days again, not 2', () => {
    expect(comeback(['q', 'q', 'q', 'm', 'q', 'q', 'o'])).toBeUndefined()
    expect(comeback(['q', 'q', 'q', 'm', 'q', 'q'])).toBeUndefined()
  })

  it('a longer break is fine', () => {
    expect(comeback(['q', 'q', 'q', 'q', 'q', 'm', 'm', 'm', 'm', 'q', 'q', 'q'])).toBeDefined()
  })

  it('a frozen day does not break a streak, so it is not a comeback', () => {
    expect(comeback(['q', 'q', 'q', 'f', 'q', 'q', 'q'])).toBeUndefined()
    expect(comeback(['q', 'q', 'q', 'f', 'q', 'q', 'q', 'q', 'q'])).toBeUndefined()
  })

  it('a frozen day inside the new run keeps that run alive', () => {
    expect(comeback(['q', 'q', 'q', 'm', 'q', 'f', 'q', 'q'])).toBeDefined()
  })

  it('a streak that ends after a freeze is used up still counts as ended', () => {
    // 3 days, the freeze covers day 4, day 5 is missed: the streak ended on an unfrozen day.
    expect(comeback(['q', 'q', 'q', 'f', 'm', 'q', 'q', 'q'])).toBeDefined()
  })

  it('remembers an earlier break through a shorter false start', () => {
    expect(comeback(['q', 'q', 'q', 'm', 'q', 'q', 'm', 'q', 'q', 'q'])).toBeDefined()
  })

  it('is not earned while the first streak is running, however long', () => {
    expect(comeback(q(40))).toBeUndefined()
    expect(comeback(['q', 'q', 'q', 'm', 'o'])).toBeUndefined()
  })

  it('a gap in the day list is a break', () => {
    const streak: BadgeStreak = {
      days: [...streakFrom(START, q(3)).days, ...streakFrom(addDays(START, 6), q(3)).days],
    }
    expect(find(evaluateBadges(input({ streak })), 'comeback')?.unlockedAt).toBe(
      dayStartMs(addDays(START, 8)),
    )
  })

  it('reads the first counted session of that day when there is one', () => {
    const day = addDays(START, 6)
    const s = session(dayStartMs(day) + 10 * 60 * MIN, 25)
    const unlocks = evaluateBadges(
      input({ sessions: [s], streak: streakFrom(START, ['q', 'q', 'q', 'm', 'q', 'q', 'q']) }),
    )
    expect(find(unlocks, 'comeback')?.unlockedAt).toBe(s.endedAt)
  })
})

describe('the order and shape of the result', () => {
  it('lists unlocks oldest first', () => {
    const sessions = [session(at(2026, 9, 29, 7, 30), 25), session(at(2026, 9, 30, 23, 0), 25)]
    const unlocks = evaluateBadges(input({ sessions }))
    const times = unlocks.map((u) => u.unlockedAt)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(ids(unlocks).slice(0, 2)).toEqual(['first-focus', 'early-bird'])
  })

  it('never returns a badge twice', () => {
    const sessions = Array.from({ length: 30 }, (_, i) => session(at(2026, 9, 1 + i, 7, 0), 25))
    const list = ids(evaluateBadges(input({ sessions, streak: streakFrom('2026-09-01', q(30)) })))
    expect(new Set(list).size).toBe(list.length)
  })
})

describe('computeStreakForBadges', () => {
  it('is empty without rows', () => {
    expect(computeStreakForBadges([], '2026-09-29')).toEqual({ days: [] })
  })

  it('runs from the first row to today, with two days off in a week as missed days', () => {
    const streak = computeStreakForBadges(
      [
        { day: '2026-09-22', qualified: true },
        { day: '2026-09-23', qualified: true },
        { day: '2026-09-26', qualified: true },
      ],
      '2026-09-27',
    )
    expect(streak.days.map((d) => `${d.day}:${d.status}`)).toEqual([
      '2026-09-22:qualified',
      '2026-09-23:qualified',
      '2026-09-24:missed',
      '2026-09-25:missed',
      '2026-09-26:qualified',
      '2026-09-27:open',
    ])
  })

  it('covers one day off with the weekly freeze, from the streak engine', () => {
    const rows = [
      { day: '2026-09-25', qualified: true },
      { day: '2026-09-26', qualified: true },
      { day: '2026-09-28', qualified: true },
    ]
    const streak = computeStreakForBadges(rows, '2026-09-29')
    expect(streak.days.map((d) => `${d.day}:${d.status}`)).toEqual([
      '2026-09-25:qualified',
      '2026-09-26:qualified',
      '2026-09-27:frozen',
      '2026-09-28:qualified',
      '2026-09-29:open',
    ])
    // Sunday-first weeks put Saturday and Sunday in different weeks; the answer here is the same.
    expect(computeStreakForBadges(rows, '2026-09-29', 0)).toEqual(streak)
  })

  it('shows today as qualified once it is, and a finished day with a row that did not qualify as missed', () => {
    const streak = computeStreakForBadges(
      [
        { day: '2026-09-28', qualified: false },
        { day: '2026-09-29', qualified: true },
      ],
      '2026-09-29',
    )
    expect(streak.days.map((d) => d.status)).toEqual(['missed', 'qualified'])
  })

  it('ignores rows after today and malformed days', () => {
    const streak = computeStreakForBadges(
      [
        { day: '2026-09-30', qualified: true },
        { day: 'not-a-day', qualified: true },
        { day: '2026-09-29', qualified: true },
      ],
      '2026-09-29',
    )
    expect(streak.days).toEqual([{ day: '2026-09-29', status: 'qualified' }])
  })

  it('crosses daylight-saving days without dropping or doubling a day', () => {
    const streak = computeStreakForBadges([{ day: '2026-03-06', qualified: true }], '2026-03-10')
    expect(streak.days.map((d) => d.day)).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ])
  })
})

describe('re-evaluating on more data', () => {
  /** 50 days of sessions (varied times), a break, and a comeback, with two courses finishing. */
  function scenario() {
    const sessions: BadgeSessionRow[] = []
    const rows: { day: ISODate; qualified: boolean }[] = []
    const startDay = '2026-07-01'
    for (let i = 0; i < 50; i++) {
      const day = addDays(startDay, i)
      const broken = i >= 12 && i <= 13 // a two-day break after 12 days
      if (broken) {
        rows.push({ day, qualified: false })
        continue
      }
      const hours = i % 7 === 0 ? [6, 9, 12, 15, 22] : [9 + (i % 4)]
      for (const h of hours)
        sessions.push(session(dayStartMs(day) + h * 60 * MIN, 25 + (i % 3) * 5))
      rows.push({ day, qualified: true })
    }
    const courses = [
      course({
        id: 'a',
        termId: 't1',
        code: 'C182',
        status: 'done',
        completedAt: at(2026, 7, 20, 14),
      }),
      course({
        id: 'b',
        termId: 't1',
        code: 'D278',
        status: 'done',
        completedAt: at(2026, 8, 12, 14),
      }),
    ]
    const goals: BadgeGoalRow[] = [
      { id: 'g1', terms: [{ id: 't1', label: 'Term 1', start: '2026-07-01', end: '2026-12-31' }] },
    ]
    return { sessions, rows, courses, goals, startDay }
  }

  /**
   * What a run at `cutoff` would have seen: only what had happened by then. A day's streak row exists
   * because a counted session ended, so today qualifies only once one has; a course not yet finished is
   * still a course with status `active`.
   */
  function evaluateAt(cutoff: Millis, s: ReturnType<typeof scenario>): BadgeUnlock[] {
    const today = dayOf(cutoff)
    const sessions = s.sessions.filter((x) => (x.endedAt ?? 0) <= cutoff)
    const doneToday = sessions.some((x) => x.day === today)
    return evaluateBadges({
      sessions,
      courses: s.courses.map((c) =>
        (c.completedAt ?? Infinity) <= cutoff ? c : { ...c, status: 'active', completedAt: null },
      ),
      goals: s.goals,
      streak: computeStreakForBadges(
        [...s.rows.filter((r) => r.day < today), { day: today, qualified: doneToday }],
        today,
      ),
    })
  }

  it('keeps every earlier unlock exactly as it was, at any later evaluation', () => {
    const s = scenario()
    const finalNow = at(2026, 8, 25, 23, 59)
    const final = evaluateAt(finalNow, s)
    expect(ids(final)).toEqual(
      expect.arrayContaining([
        'first-focus',
        'early-bird',
        'night-owl',
        'deep-work',
        'streak-7',
        'first-course',
        'term-complete',
        'comeback',
      ]),
    )
    for (let hours = 6; hours < 50 * 24; hours += 7) {
      const cutoff = at(2026, 7, 1, 0) + hours * 60 * MIN
      for (const earlier of evaluateAt(cutoff, s)) {
        expect(final.find((u) => u.id === earlier.id)).toEqual(earlier)
      }
    }
  })

  it('gives the same answer twice and does not depend on the order of the rows', () => {
    const s = scenario()
    const forward = evaluateBadges({ ...s, streak: computeStreakForBadges(s.rows, '2026-08-25') })
    const shuffled = evaluateBadges({
      ...s,
      sessions: [...s.sessions].reverse(),
      courses: [...s.courses].reverse(),
      streak: computeStreakForBadges([...s.rows].reverse(), '2026-08-25'),
    })
    expect(shuffled).toEqual(forward)
    expect(evaluateBadges({ ...s, streak: computeStreakForBadges(s.rows, '2026-08-25') })).toEqual(
      forward,
    )
  })
})

describe('display helpers', () => {
  const stored = [
    { id: 'early-bird' as const, unlockedAt: at(2026, 9, 29, 7, 55), context: 'Started at 07:30' },
    { id: 'first-focus' as const, unlockedAt: at(2026, 9, 10, 9, 30), context: null },
  ]

  it('merges stored unlocks into all eleven badges, in the brief order', () => {
    const states = badgeStates(stored)
    expect(states).toHaveLength(11)
    expect(states.map((s) => s.id)[0]).toBe('first-focus')
    expect(states.filter((s) => s.unlocked).map((s) => s.id)).toEqual(['first-focus', 'early-bird'])
    expect(states.find((s) => s.id === 'night-owl')).toMatchObject({
      unlocked: false,
      unlockedAt: null,
      context: null,
    })
  })

  it('ignores stored ids this build does not know', () => {
    const states = badgeStates([
      ...stored,
      { id: 'speed-runner' as unknown as BadgeId, unlockedAt: 1, context: null },
    ])
    expect(states).toHaveLength(11)
    expect(unlockSummary(states)).toBe('2 of 11 unlocked')
  })

  it('lists the newest unlocks first and honours the limit', () => {
    expect(recentBadges(stored, 5).map((s) => s.id)).toEqual(['early-bird', 'first-focus'])
    expect(recentBadges(stored, 1).map((s) => s.id)).toEqual(['early-bird'])
    expect(recentBadges(stored, 0)).toEqual([])
    expect(recentBadges([], 3)).toEqual([])
  })

  it('formats the unlock date, adding the year when it is not this year', () => {
    const now = at(2026, 9, 29, 9, 30)
    expect(formatUnlockDate(at(2026, 9, 29, 7, 55), now)).toBe('Sep 29')
    expect(formatUnlockDate(at(2025, 12, 31, 23, 59), now)).toBe('Dec 31, 2025')
  })
})

describe('unlockMessages', () => {
  it('says "Badge unlocked · Early Bird 🌅" for one badge, with what it means', () => {
    expect(unlockMessages(['early-bird'])).toEqual([
      {
        key: 'badge:early-bird',
        title: 'Badge unlocked · Early Bird 🌅',
        description: 'Started a focus session before 8 a.m.',
      },
    ])
  })

  it('gives two badges a toast each, in the order given', () => {
    expect(unlockMessages(['first-focus', 'early-bird']).map((m) => m.title)).toEqual([
      'Badge unlocked · First Focus 🌱',
      'Badge unlocked · Early Bird 🌅',
    ])
  })

  it('folds three or more into one summary line', () => {
    const messages = unlockMessages(['first-focus', 'early-bird', 'night-owl'])
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      title: '3 badges unlocked',
      description: 'First Focus 🌱, Early Bird 🌅, Night Owl 🦉',
    })
  })

  it('says nothing for nothing, and skips ids it does not know', () => {
    expect(unlockMessages([])).toEqual([])
    expect(unlockMessages(['speed-runner'])).toEqual([])
  })
})
