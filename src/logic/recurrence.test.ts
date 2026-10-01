// Runs with TZ=America/New_York. DST 2026: starts Sun Mar 8, ends Sun Nov 1.
import { describe, expect, it } from 'vitest'
import type { RecurrenceRule } from '@/db/types'
import { addDays, weekdayOf } from '@/logic/dates'
import {
  describeRecurrence,
  firstOccurrence,
  nextOccurrence,
  nextOccurrences,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT_NAMES,
} from '@/logic/recurrence'

const rule = (
  freq: RecurrenceRule['freq'],
  interval = 1,
  byWeekday: number[] = [],
): RecurrenceRule => ({ freq, interval, byWeekday })

// Calendar for the examples: Mon 2026-09-28, Tue 29, Wed 30, Thu Oct 1, Fri 2, Sat 3, Sun 4, Mon 5.

describe('nextOccurrence: daily', () => {
  it('adds the interval in days', () => {
    expect(nextOccurrence(rule('daily'), '2026-09-29')).toBe('2026-09-30')
    expect(nextOccurrence(rule('daily', 3), '2026-09-29')).toBe('2026-10-02')
  })

  it('crosses month, year and leap-day boundaries', () => {
    expect(nextOccurrence(rule('daily'), '2026-09-30')).toBe('2026-10-01')
    expect(nextOccurrence(rule('daily'), '2026-12-31')).toBe('2027-01-01')
    expect(nextOccurrence(rule('daily'), '2028-02-28')).toBe('2028-02-29')
    expect(nextOccurrence(rule('daily'), '2027-02-28')).toBe('2027-03-01')
  })

  it('counts whole calendar days across DST changes', () => {
    expect(nextOccurrence(rule('daily'), '2026-03-07')).toBe('2026-03-08')
    expect(nextOccurrence(rule('daily'), '2026-03-08')).toBe('2026-03-09')
    expect(nextOccurrence(rule('daily', 2), '2026-03-07')).toBe('2026-03-09')
    expect(nextOccurrence(rule('daily'), '2026-10-31')).toBe('2026-11-01')
    expect(nextOccurrence(rule('daily'), '2026-11-01')).toBe('2026-11-02')
    expect(nextOccurrence(rule('daily', 7), '2026-10-28')).toBe('2026-11-04')
  })
})

describe('nextOccurrence: weekdays', () => {
  it.each([
    ['2026-09-28', '2026-09-29'], // Mon → Tue
    ['2026-09-29', '2026-09-30'],
    ['2026-10-01', '2026-10-02'],
    ['2026-10-02', '2026-10-05'], // Fri → Mon
    ['2026-10-03', '2026-10-05'], // Sat → Mon
    ['2026-10-04', '2026-10-05'], // Sun → Mon
  ])('%s → %s', (from, expected) => {
    expect(nextOccurrence(rule('weekdays'), from)).toBe(expected)
  })

  it('skips the weekend across DST', () => {
    expect(nextOccurrence(rule('weekdays'), '2026-03-06')).toBe('2026-03-09') // Fri → Mon over Mar 8
    expect(nextOccurrence(rule('weekdays'), '2026-10-30')).toBe('2026-11-02') // Fri → Mon over Nov 1
  })

  it('ignores interval and byWeekday', () => {
    expect(nextOccurrence(rule('weekdays', 5, [0, 6]), '2026-09-29')).toBe('2026-09-30')
  })
})

describe('nextOccurrence: weekly', () => {
  it('with no weekdays repeats the weekday of the date it advances from', () => {
    expect(nextOccurrence(rule('weekly'), '2026-09-29')).toBe('2026-10-06')
    expect(nextOccurrence(rule('weekly', 2), '2026-09-29')).toBe('2026-10-13')
    expect(nextOccurrence(rule('weekly'), '2026-10-04')).toBe('2026-10-11') // Sunday
  })

  it('crosses DST changes', () => {
    expect(nextOccurrence(rule('weekly'), '2026-03-01')).toBe('2026-03-08')
    expect(nextOccurrence(rule('weekly'), '2026-03-08')).toBe('2026-03-15')
    expect(nextOccurrence(rule('weekly'), '2026-10-25')).toBe('2026-11-01')
    expect(nextOccurrence(rule('weekly', 2), '2026-10-25')).toBe('2026-11-08')
  })

  it('moves to the next listed weekday, then wraps to the next week', () => {
    const mwf = rule('weekly', 1, [1, 3, 5])
    expect(nextOccurrence(mwf, '2026-09-28')).toBe('2026-09-30') // Mon → Wed
    expect(nextOccurrence(mwf, '2026-09-30')).toBe('2026-10-02') // Wed → Fri
    expect(nextOccurrence(mwf, '2026-10-02')).toBe('2026-10-05') // Fri → Mon
    expect(nextOccurrence(mwf, '2026-10-03')).toBe('2026-10-05') // Sat → Mon
    expect(nextOccurrence(mwf, '2026-10-04')).toBe('2026-10-05') // Sun → Mon
    expect(nextOccurrence(mwf, '2026-09-29')).toBe('2026-09-30') // Tue (not listed) → Wed
  })

  it('handles Sunday as a listed day (weeks run Monday to Sunday)', () => {
    const sun = rule('weekly', 1, [0])
    expect(nextOccurrence(sun, '2026-09-28')).toBe('2026-10-04') // Mon → this Sunday
    expect(nextOccurrence(sun, '2026-10-04')).toBe('2026-10-11') // Sun → next Sunday
    const satSun = rule('weekly', 1, [6, 0])
    expect(nextOccurrence(satSun, '2026-10-03')).toBe('2026-10-04')
    expect(nextOccurrence(satSun, '2026-10-04')).toBe('2026-10-10')
  })

  it('every 2 weeks on Mon and Thu skips the off week', () => {
    const r = rule('weekly', 2, [1, 4])
    expect(nextOccurrence(r, '2026-09-28')).toBe('2026-10-01') // Mon → Thu, same week
    expect(nextOccurrence(r, '2026-10-01')).toBe('2026-10-12') // Thu → Mon two weeks on
    expect(nextOccurrence(r, '2026-10-04')).toBe('2026-10-12') // Sun ends the week
  })

  it('cleans up unsorted, duplicate and invalid weekdays', () => {
    const messy = rule('weekly', 1, [5, 1, 1, 9, -1, 1.5, NaN])
    expect(nextOccurrence(messy, '2026-09-28')).toBe('2026-10-02') // only Mon and Fri count
    expect(nextOccurrence(messy, '2026-10-02')).toBe('2026-10-05')
    // Nothing valid left: same weekday next week.
    expect(nextOccurrence(rule('weekly', 1, [9, -3]), '2026-09-29')).toBe('2026-10-06')
  })

  it('crosses year boundaries', () => {
    expect(nextOccurrence(rule('weekly', 1, [5]), '2026-12-28')).toBe('2027-01-01')
    expect(nextOccurrence(rule('weekly', 1, [1]), '2026-12-31')).toBe('2027-01-04')
  })
})

describe('nextOccurrence: custom', () => {
  it('every N days when there are no weekdays', () => {
    expect(nextOccurrence(rule('custom', 3), '2026-09-29')).toBe('2026-10-02')
    expect(nextOccurrence(rule('custom', 10), '2026-10-28')).toBe('2026-11-07')
  })

  it('every N weeks on the listed weekdays', () => {
    expect(nextOccurrence(rule('custom', 2, [2]), '2026-09-29')).toBe('2026-10-13')
    expect(nextOccurrence(rule('custom', 1, [1, 4]), '2026-09-28')).toBe('2026-10-01')
    expect(nextOccurrence(rule('custom', 3, [3]), '2026-09-30')).toBe('2026-10-21')
  })
})

describe('nextOccurrence: robustness', () => {
  it('treats a bad interval as 1', () => {
    for (const interval of [0, -2, NaN, Infinity, -Infinity]) {
      expect(nextOccurrence(rule('daily', interval), '2026-09-29')).toBe('2026-09-30')
    }
    expect(nextOccurrence(rule('daily', 2.9), '2026-09-29')).toBe('2026-10-01')
  })

  it('always moves strictly forward, whatever the rule and start', () => {
    const rules = [
      rule('daily'),
      rule('daily', 4),
      rule('weekdays'),
      rule('weekly'),
      rule('weekly', 3),
      rule('weekly', 1, [0, 2, 4]),
      rule('weekly', 2, [6]),
      rule('custom', 5),
      rule('custom', 2, [1, 5]),
    ]
    for (const r of rules) {
      // Sweeps DST and year boundaries.
      for (let d = '2026-02-20'; d < '2027-01-10'; d = addDays(d, 1)) {
        const next = nextOccurrence(r, d)
        expect(next > d).toBe(true)
        expect(next <= addDays(d, 7 * Math.max(1, r.interval) + 1)).toBe(true)
      }
    }
  })

  it('every result of a weekday-constrained rule lands on an allowed weekday', () => {
    const r = rule('weekly', 1, [1, 3, 5])
    for (let d = '2026-09-01'; d < '2026-12-01'; d = addDays(d, 1)) {
      expect([1, 3, 5]).toContain(weekdayOf(nextOccurrence(r, d)))
    }
    for (let d = '2026-09-01'; d < '2026-12-01'; d = addDays(d, 1)) {
      const wd = weekdayOf(nextOccurrence(rule('weekdays'), d))
      expect(wd >= 1 && wd <= 5).toBe(true)
    }
  })
})

describe('nextOccurrences', () => {
  it('lists the next few occurrences', () => {
    expect(nextOccurrences(rule('weekdays'), '2026-10-01', 4)).toEqual([
      '2026-10-02',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
    ])
    expect(nextOccurrences(rule('weekly', 1, [1, 4]), '2026-09-28', 3)).toEqual([
      '2026-10-01',
      '2026-10-05',
      '2026-10-08',
    ])
    expect(nextOccurrences(rule('daily'), '2026-03-07', 3)).toEqual([
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ])
    expect(nextOccurrences(rule('daily'), '2026-03-07', 0)).toEqual([])
  })
})

describe('firstOccurrence', () => {
  it('starts on the day itself when the rule has no weekday pattern', () => {
    expect(firstOccurrence(rule('daily'), '2026-09-29')).toBe('2026-09-29')
    expect(firstOccurrence(rule('daily', 3), '2026-09-29')).toBe('2026-09-29')
    expect(firstOccurrence(rule('weekly'), '2026-09-29')).toBe('2026-09-29')
    expect(firstOccurrence(rule('weekly', 2), '2026-09-29')).toBe('2026-09-29')
    expect(firstOccurrence(rule('custom', 4), '2026-09-29')).toBe('2026-09-29')
  })

  it('weekdays: today when Monday to Friday, else the next Monday', () => {
    expect(firstOccurrence(rule('weekdays'), '2026-09-29')).toBe('2026-09-29')
    expect(firstOccurrence(rule('weekdays'), '2026-10-03')).toBe('2026-10-05')
    expect(firstOccurrence(rule('weekdays'), '2026-10-04')).toBe('2026-10-05')
  })

  it('listed weekdays: today when it matches, else the next one', () => {
    expect(firstOccurrence(rule('weekly', 1, [1]), '2026-09-29')).toBe('2026-10-05') // Tue → Mon
    expect(firstOccurrence(rule('weekly', 1, [1]), '2026-09-28')).toBe('2026-09-28') // Mon → today
    expect(firstOccurrence(rule('weekly', 1, [1, 3, 5]), '2026-09-29')).toBe('2026-09-30')
    expect(firstOccurrence(rule('custom', 1, [2]), '2026-09-29')).toBe('2026-09-29')
  })

  it('works across DST', () => {
    expect(firstOccurrence(rule('weekly', 1, [0]), '2026-03-07')).toBe('2026-03-08')
    expect(firstOccurrence(rule('weekdays'), '2026-11-01')).toBe('2026-11-02')
  })
})

describe('describeRecurrence', () => {
  it.each<[RecurrenceRule, string]>([
    [rule('daily'), 'Every day'],
    [rule('daily', 3), 'Every 3 days'],
    [rule('weekdays'), 'Every weekday'],
    [rule('weekdays', 2, [1]), 'Every weekday'],
    [rule('weekly'), 'Every week'],
    [rule('weekly', 2), 'Every 2 weeks'],
    [rule('weekly', 1, [1]), 'Every Monday'],
    [rule('weekly', 1, [3]), 'Every Wednesday'],
    [rule('weekly', 1, [1, 3, 5]), 'Every Mon, Wed, Fri'],
    [rule('weekly', 1, [5, 1]), 'Every Mon, Fri'],
    [rule('weekly', 1, [1, 2, 3, 4, 5]), 'Every weekday'],
    [rule('weekly', 1, [0, 1, 2, 3, 4, 5, 6]), 'Every day'],
    [rule('weekly', 2, [1]), 'Every 2 weeks on Monday'],
    [rule('weekly', 2, [1, 4]), 'Every 2 weeks on Mon, Thu'],
    [rule('custom', 3), 'Every 3 days'],
    [rule('custom', 1), 'Every day'],
    [rule('custom', 2, [2]), 'Every 2 weeks on Tuesday'],
    [rule('daily', 0), 'Every day'],
    [rule('weekly', 1, [9]), 'Every week'],
  ])('%j → %s', (r, text) => {
    expect(describeRecurrence(r)).toBe(text)
  })

  it('exposes weekday names indexed from Sunday', () => {
    expect(WEEKDAY_NAMES).toHaveLength(7)
    expect(WEEKDAY_NAMES[0]).toBe('Sunday')
    expect(WEEKDAY_SHORT_NAMES[6]).toBe('Sat')
  })
})
