import { describe, expect, it } from 'vitest'
import type { ISODate } from '@/db/types'
import { medianCpuMs } from '@/test/timing'
import { addDays } from './dates'
import {
  SCAN_DAYS,
  computeStreak,
  isDayQualified,
  statusOn,
  streakMilestoneKey,
  type StreakDayStatus,
  type StreakRecord,
  type StreakResult,
} from './streaks'
import type { WeekStart } from './dates'

/*
 * September 2026, the week the tests live in (America/New_York, EDT):
 *   Mon 21  Tue 22  Wed 23  Thu 24  Fri 25  Sat 26  Sun 27
 *   Mon 28  Tue 29  Wed 30  Thu Oct 1  Fri 2  Sat 3  Sun 4
 */
const MON = 1 satisfies WeekStart
const SUN = 0 satisfies WeekStart

/** One character per day from `start`: `Q` qualified, `x` a row that did not qualify, `.` no row. */
function series(start: ISODate, pattern: string): StreakRecord[] {
  const out: StreakRecord[] = []
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === 'Q') out.push({ day: addDays(start, i), qualified: true })
    else if (c === 'x') out.push({ day: addDays(start, i), qualified: false })
  }
  return out
}

const statuses = (r: StreakResult, from: ISODate, to: ISODate): StreakDayStatus[] =>
  r.days.filter((d) => d.day >= from && d.day <= to).map((d) => d.status)

describe('isDayQualified', () => {
  it('needs a counted session or the daily goal', () => {
    expect(isDayQualified({ focusSessions: 1, dailyGoalHit: false })).toBe(true)
    expect(isDayQualified({ focusSessions: 0, dailyGoalHit: true })).toBe(true)
    expect(isDayQualified({ focusSessions: 0, dailyGoalHit: false })).toBe(false)
  })
})

describe('computeStreak: a run of days', () => {
  it('is quiet with no records, and today is open', () => {
    const r = computeStreak([], '2026-09-29', MON)
    expect(r).toMatchObject({
      current: 0,
      best: 0,
      currentStart: null,
      freezesUsed: 0,
      freezeAvailableThisWeek: true,
      milestonesReached: [],
    })
    expect(r.days[0]).toEqual({ day: '2026-09-29', status: 'today-open' })
    expect(r.days.slice(1).map((d) => d.status)).toEqual(Array(5).fill('future'))
  })

  it('counts qualifying days up to today', () => {
    const r = computeStreak(series('2026-09-27', 'QQQ'), '2026-09-29', MON)
    expect(r.current).toBe(3)
    expect(r.best).toBe(3)
    expect(r.currentStart).toBe('2026-09-27')
    expect(statuses(r, '2026-09-27', '2026-09-29')).toEqual(['qualified', 'qualified', 'qualified'])
  })

  it('keeps the run alive while today is still open', () => {
    const r = computeStreak(series('2026-09-26', 'QQQ'), '2026-09-29', MON)
    expect(r.current).toBe(3)
    expect(r.currentStart).toBe('2026-09-26')
    expect(statusOn(r, '2026-09-29')).toBe('today-open')
  })

  it('starts the list at the first record, not before', () => {
    const r = computeStreak(series('2026-09-25', 'Q'), '2026-09-29', MON)
    expect(r.days[0]).toEqual({ day: '2026-09-25', status: 'qualified' })
    expect(statuses(r, '2026-09-25', '2026-09-29')).toEqual([
      'qualified',
      'rest',
      'rest',
      'rest',
      'today-open',
    ])
  })

  it('treats a row that did not qualify as a rest day', () => {
    const r = computeStreak(series('2026-09-25', 'xxQ'), '2026-09-27', MON)
    expect(statuses(r, '2026-09-25', '2026-09-27')).toEqual(['rest', 'rest', 'qualified'])
    expect(r.freezesUsed).toBe(0)
    expect(r.current).toBe(1)
  })

  it('remembers the best run once the current one is shorter', () => {
    const r = computeStreak(series('2026-09-14', 'QQQQQ...QQ'), '2026-09-23', MON)
    expect(r.current).toBe(2)
    expect(r.best).toBe(5)
    expect(r.currentStart).toBe('2026-09-22')
  })
})

describe('computeStreak: the weekly freeze', () => {
  it('covers one day off inside a streak, which carries on without growing', () => {
    // Mon Q, Tue Q, Wed off, Thu Q.
    const r = computeStreak(series('2026-09-21', 'QQ.Q'), '2026-09-24', MON)
    expect(statuses(r, '2026-09-21', '2026-09-24')).toEqual([
      'qualified',
      'qualified',
      'frozen',
      'qualified',
    ])
    expect(r.current).toBe(3)
    expect(r.currentStart).toBe('2026-09-21')
    expect(r.freezesUsed).toBe(1)
    expect(r.freezeAvailableThisWeek).toBe(false)
  })

  it('ends the streak on a second day off in the same week', () => {
    // Mon Q, Tue off (frozen), Wed Q, Thu off (ends), Fri Q starts again.
    const r = computeStreak(series('2026-09-21', 'Q.Q.Q'), '2026-09-25', MON)
    expect(statuses(r, '2026-09-21', '2026-09-25')).toEqual([
      'qualified',
      'frozen',
      'qualified',
      'rest',
      'qualified',
    ])
    expect(r.current).toBe(1)
    expect(r.currentStart).toBe('2026-09-25')
    expect(r.best).toBe(2)
  })

  it('does not spend a freeze on a streak that was already over', () => {
    // Mon Q, Tue Q, then two days off: the streak is over, so Wednesday is a plain rest day.
    const r = computeStreak(series('2026-09-21', 'QQ..Q'), '2026-09-25', MON)
    expect(statuses(r, '2026-09-21', '2026-09-25')).toEqual([
      'qualified',
      'qualified',
      'rest',
      'rest',
      'qualified',
    ])
    expect(r.freezesUsed).toBe(0)
    expect(r.freezeAvailableThisWeek).toBe(true)
    expect(r.current).toBe(1)
  })

  it('gives every week its own freeze', () => {
    // Off on Tue 22 and Mon 28: one freeze each week.
    const r = computeStreak(series('2026-09-21', 'Q.QQQQQ.Q'), '2026-09-29', MON)
    expect(statusOn(r, '2026-09-22')).toBe('frozen')
    expect(statusOn(r, '2026-09-28')).toBe('frozen')
    expect(r.freezesUsed).toBe(2)
    expect(r.current).toBe(7) // qualifying days only: the two frozen days do not count
    expect(r.freezeAvailableThisWeek).toBe(false)
  })

  it('freezes yesterday while today is open, when the week still has its freeze', () => {
    // Mon Q, Tue Q, Wed off, today Thu open.
    const r = computeStreak(series('2026-09-21', 'QQ'), '2026-09-24', MON)
    expect(statuses(r, '2026-09-21', '2026-09-24')).toEqual([
      'qualified',
      'qualified',
      'frozen',
      'today-open',
    ])
    expect(r.current).toBe(2)
    expect(r.freezeAvailableThisWeek).toBe(false)
  })

  it('confirms yesterday’s freeze once today qualifies', () => {
    const r = computeStreak(series('2026-09-21', 'QQ.Q'), '2026-09-24', MON)
    expect(statusOn(r, '2026-09-23')).toBe('frozen')
    expect(statusOn(r, '2026-09-24')).toBe('qualified')
    expect(r.current).toBe(3)
  })

  it('does not freeze yesterday when this week’s freeze is already spent', () => {
    // Mon Q, Tue off (frozen), Wed Q, Thu off (no freeze left), today Fri open.
    const r = computeStreak(series('2026-09-21', 'Q.Q'), '2026-09-25', MON)
    expect(statuses(r, '2026-09-21', '2026-09-25')).toEqual([
      'qualified',
      'frozen',
      'qualified',
      'rest',
      'today-open',
    ])
    expect(r.current).toBe(0)
    expect(r.currentStart).toBeNull()
    expect(r.best).toBe(2)
  })

  it('un-freezes a provisional freeze when the streak ends anyway', () => {
    // Mon Q, Tue Q, Wed off (provisional), Thu off (ends), today Fri open.
    const r = computeStreak(series('2026-09-21', 'QQ'), '2026-09-25', MON)
    expect(statuses(r, '2026-09-23', '2026-09-25')).toEqual(['rest', 'rest', 'today-open'])
    expect(r.freezesUsed).toBe(0)
    expect(r.freezeAvailableThisWeek).toBe(true)
    expect(r.current).toBe(0)
  })

  it('uses last week’s freeze for a Sunday off, and keeps this week’s', () => {
    // Fri Q, Sat Q, Sun off, today Mon open (weeks start Monday).
    const r = computeStreak(series('2026-09-25', 'QQ'), '2026-09-28', MON)
    expect(statusOn(r, '2026-09-27')).toBe('frozen')
    expect(r.current).toBe(2)
    expect(r.freezeAvailableThisWeek).toBe(true)
  })
})

describe('computeStreak: week start', () => {
  // Fri Q, Sat off, Sun off, Mon Q.
  const records = series('2026-09-25', 'Q..Q')

  it('with Monday-first weeks, Saturday and Sunday share a freeze, so the second day ends it', () => {
    const r = computeStreak(records, '2026-09-28', MON)
    expect(statuses(r, '2026-09-25', '2026-09-28')).toEqual([
      'qualified',
      'rest',
      'rest',
      'qualified',
    ])
    expect(r.current).toBe(1)
  })

  it('with Sunday-first weeks, each of them has its own freeze and the streak carries on', () => {
    const r = computeStreak(records, '2026-09-28', SUN)
    expect(statuses(r, '2026-09-25', '2026-09-28')).toEqual([
      'qualified',
      'frozen',
      'frozen',
      'qualified',
    ])
    expect(r.current).toBe(2)
    expect(r.freezesUsed).toBe(2)
  })

  it('decides whether this week’s freeze is spent', () => {
    // Thu Q, Fri Q, Sat off, today Sun open.
    const records2 = series('2026-09-24', 'QQ')
    expect(computeStreak(records2, '2026-09-27', MON).freezeAvailableThisWeek).toBe(false)
    expect(computeStreak(records2, '2026-09-27', SUN).freezeAvailableThisWeek).toBe(true)
  })

  it('lists the rest of the current week as future days', () => {
    const mon = computeStreak([], '2026-09-29', MON)
    const sun = computeStreak([], '2026-09-29', SUN)
    expect(mon.days.filter((d) => d.status === 'future').map((d) => d.day)).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ])
    expect(sun.days.filter((d) => d.status === 'future').map((d) => d.day)).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ])
  })
})

describe('computeStreak: input', () => {
  it('gives the same answer for unsorted and repeated records', () => {
    const sorted = series('2026-09-14', 'QQQ.QQ.Q')
    const shuffled = [
      sorted[4]!,
      sorted[0]!,
      { day: sorted[2]!.day, qualified: false }, // a stale duplicate: any qualified row wins
      sorted[5]!,
      sorted[1]!,
      sorted[2]!,
      sorted[3]!,
      sorted[0]!,
    ]
    expect(computeStreak(shuffled, '2026-09-22', MON)).toEqual(
      computeStreak(sorted, '2026-09-22', MON),
    )
  })

  it('ignores records after today and malformed days', () => {
    const r = computeStreak(
      [
        { day: '2026-10-01', qualified: true },
        { day: 'not-a-day', qualified: true },
        { day: '2026-02-30', qualified: true },
        { day: '2026-09-29', qualified: true },
      ],
      '2026-09-29',
      MON,
    )
    expect(r.current).toBe(1)
    expect(statusOn(r, '2026-10-01')).toBe('future')
  })

  it('does not change its input', () => {
    const records = series('2026-09-21', 'QQ.Q')
    const copy = structuredClone(records)
    computeStreak(records, '2026-09-24', MON)
    expect(records).toEqual(copy)
  })
})

describe('computeStreak: milestones', () => {
  it('reports 7 days with a stable key that does not change as the streak grows', () => {
    const start = '2026-09-20'
    const at7 = computeStreak(series(start, 'Q'.repeat(7)), '2026-09-26', MON)
    expect(at7.milestonesReached).toEqual([
      { days: 7, on: '2026-09-26', key: streakMilestoneKey(7, start) },
    ])
    expect(at7.milestonesReached[0]?.key).toBe('streak:7:2026-09-20')

    const at10 = computeStreak(series(start, 'Q'.repeat(10)), '2026-09-29', MON)
    expect(at10.milestonesReached).toEqual(at7.milestonesReached)
    expect(at10.currentStart).toBe(start)
  })

  it('does not report 7 at six days', () => {
    expect(
      computeStreak(series('2026-09-24', 'Q'.repeat(6)), '2026-09-29', MON).milestonesReached,
    ).toEqual([])
  })

  it('reports 7, 30 and 100 in the order they happened', () => {
    const start = '2026-06-21'
    const r = computeStreak(series(start, 'Q'.repeat(101)), addDays(start, 100), MON)
    expect(r.milestonesReached.map((m) => [m.days, m.on])).toEqual([
      [7, addDays(start, 6)],
      [30, addDays(start, 29)],
      [100, addDays(start, 99)],
    ])
    expect(new Set(r.milestonesReached.map((m) => m.key)).size).toBe(3)
  })

  it('counts only qualifying days: a frozen day pushes the milestone one day later', () => {
    // 6 days, a frozen Tuesday-style gap, then the 7th qualifying day.
    const r = computeStreak(series('2026-09-21', 'Q.QQQQQ.Q'), '2026-09-29', MON)
    expect(r.milestonesReached).toEqual([{ days: 7, on: '2026-09-29', key: 'streak:7:2026-09-21' }])
  })

  it('gives a new streak its own key, and still lists the earlier streak’s milestone', () => {
    // 8 days, three days off (a freeze covers two of them across the Sunday/Monday boundary, but not
    // the third), then 7 more.
    const r = computeStreak(series('2026-08-01', 'QQQQQQQQ...QQQQQQQ'), '2026-08-18', MON)
    expect(r.milestonesReached.map((m) => m.key)).toEqual([
      'streak:7:2026-08-01',
      'streak:7:2026-08-12',
    ])
    expect(r.currentStart).toBe('2026-08-12')
    expect(r.best).toBe(8)
  })
})

describe('computeStreak: daylight-saving days', () => {
  it('runs through the spring-forward day without dropping or doubling a day', () => {
    const r = computeStreak(series('2026-03-06', 'QQQQQ'), '2026-03-10', MON)
    expect(r.days.filter((d) => d.day <= '2026-03-10').map((d) => d.day)).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ])
    expect(r.current).toBe(5)
  })

  it('runs through the fall-back day (a 25-hour day) as one day', () => {
    const r = computeStreak(series('2026-10-30', 'QQQQQ'), '2026-11-03', SUN)
    expect(r.days.filter((d) => d.day <= '2026-11-03').map((d) => d.day)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ])
    expect(r.current).toBe(5)
  })

  it('freezes the DST day itself like any other day', () => {
    // Sunday 8 March is 23 hours long; weeks start on Monday, so its freeze is the one of 2–8 March.
    const r = computeStreak(series('2026-03-06', 'QQ.Q'), '2026-03-09', MON)
    expect(statusOn(r, '2026-03-08')).toBe('frozen')
    expect(r.current).toBe(3)
  })
})

describe('computeStreak: the scan window', () => {
  it('scans at most 400 days back, and a streak already running at its start pays no milestones', () => {
    const today = '2026-09-29'
    const start = addDays(today, -500)
    const r = computeStreak(series(start, 'Q'.repeat(501)), today, MON)
    expect(r.days.filter((d) => d.status !== 'future')).toHaveLength(SCAN_DAYS + 1)
    expect(r.days[0]?.day).toBe(addDays(today, -SCAN_DAYS))
    expect(r.current).toBe(SCAN_DAYS + 1)
    expect(r.milestonesReached).toEqual([])
  })

  it('keeps the milestones of a streak that began inside the window', () => {
    const today = '2026-09-29'
    const start = addDays(today, -300)
    const r = computeStreak(series(start, 'Q'.repeat(301)), today, MON)
    expect(r.milestonesReached.map((m) => m.days)).toEqual([7, 30, 100])
    expect(r.milestonesReached[0]?.key).toBe(`streak:7:${start}`)
  })

  it('scans 400 days in under 20 ms', () => {
    const today = '2026-09-29'
    // Two days on, one off, with a few longer breaks: plenty of freezes and endings to walk through.
    const records: StreakRecord[] = []
    for (let i = 0; i <= SCAN_DAYS; i++) {
      const off = i % 3 === 2 || i % 50 > 46
      if (!off) records.push({ day: addDays(today, -i), qualified: true })
    }
    const r = computeStreak(records, today, MON)
    expect(r.days.length).toBeGreaterThan(SCAN_DAYS)
    // CPU time, median of five runs (`@/test/timing`), so a busy machine cannot fail it.
    expect(medianCpuMs(() => computeStreak(records, today, MON))).toBeLessThan(20)
  })
})
