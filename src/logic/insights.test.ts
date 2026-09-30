import { describe, expect, it } from 'vitest'
import {
  MIN_SAMPLES,
  bestFocusHours,
  bestWeekdays,
  hourLabel,
  suggestHardTaskSlots,
  topFocusHour,
  weekdayName,
  type CheckInSample,
} from './insights'

type Rating = CheckInSample['focus']

/** `n` ratings at one hour and weekday. */
function rows(hour: number, weekday: number, ...focus: Rating[]): CheckInSample[] {
  return focus.map((f) => ({ hour, weekday, focus: f }))
}

describe('bestFocusHours', () => {
  it('is empty with no check-ins', () => {
    expect(bestFocusHours([])).toEqual([])
  })

  it('names nothing until an hour has three ratings', () => {
    const two = rows(9, 2, 5, 5)
    expect(MIN_SAMPLES).toBe(3)
    expect(bestFocusHours(two)).toEqual([])
    expect(bestFocusHours([...two, ...rows(9, 4, 5)])).toEqual([{ hour: 9, avg: 5, n: 3 }])
  })

  it('does not count ratings from different hours together', () => {
    // Three ratings in total, but no hour has three of them.
    expect(bestFocusHours([...rows(9, 1, 5), ...rows(10, 1, 5), ...rows(11, 1, 5)])).toEqual([])
  })

  it('ranks by mean rating, best first, and keeps the top three by default', () => {
    const checkIns = [
      ...rows(7, 1, 3, 3, 3), // 3.0
      ...rows(9, 1, 5, 4, 5), // 4.67
      ...rows(14, 1, 4, 4, 4), // 4.0
      ...rows(20, 1, 2, 2, 2), // 2.0
    ]
    expect(bestFocusHours(checkIns).map((h) => h.hour)).toEqual([9, 14, 7])
    const [first] = bestFocusHours(checkIns)
    expect(first?.avg).toBeCloseTo(14 / 3)
    expect(first?.n).toBe(3)
  })

  it('breaks a tie with more ratings, then the earlier hour', () => {
    const checkIns = [
      ...rows(10, 1, 4, 4, 4), // 4.0 from 3
      ...rows(15, 1, 4, 4, 4, 4), // 4.0 from 4
      ...rows(8, 1, 4, 4, 4), // 4.0 from 3, earlier than 10
    ]
    expect(bestFocusHours(checkIns).map((h) => h.hour)).toEqual([15, 8, 10])
  })

  it('honours minSamples and limit', () => {
    const checkIns = [...rows(9, 1, 5, 5), ...rows(10, 1, 4, 4, 4, 4, 4)]
    expect(bestFocusHours(checkIns, { minSamples: 2 }).map((h) => h.hour)).toEqual([9, 10])
    expect(bestFocusHours(checkIns, { minSamples: 2, limit: 1 }).map((h) => h.hour)).toEqual([9])
    expect(bestFocusHours(checkIns, { limit: 0 })).toEqual([])
  })

  it('ignores rows that are out of range instead of throwing', () => {
    const junk = [
      { hour: 24, weekday: 1, focus: 5 },
      { hour: -1, weekday: 1, focus: 5 },
      { hour: 9.5, weekday: 1, focus: 5 },
      { hour: 9, weekday: 1, focus: 0 },
      { hour: 9, weekday: 1, focus: 6 },
    ] as unknown as CheckInSample[]
    expect(bestFocusHours([...junk, ...rows(9, 1, 5, 5)])).toEqual([])
    expect(bestFocusHours([...junk, ...rows(9, 1, 5, 5, 5)])).toEqual([{ hour: 9, avg: 5, n: 3 }])
  })

  it('does not change its input', () => {
    const checkIns = [...rows(9, 1, 5, 4, 3), ...rows(8, 1, 1, 1, 1)]
    const copy = structuredClone(checkIns)
    bestFocusHours(checkIns)
    expect(checkIns).toEqual(copy)
  })
})

describe('bestWeekdays', () => {
  it('needs three ratings on a weekday', () => {
    expect(bestWeekdays(rows(9, 2, 5, 5))).toEqual([])
    expect(bestWeekdays(rows(9, 2, 5, 5, 4))).toHaveLength(1)
  })

  it('counts a weekday across hours (0 is Sunday)', () => {
    const checkIns = [
      ...rows(8, 0, 5),
      ...rows(13, 0, 5),
      ...rows(19, 0, 4), // Sunday: 4.67 from 3
      ...rows(9, 3, 3, 3, 3), // Wednesday: 3.0
    ]
    const days = bestWeekdays(checkIns)
    expect(days.map((d) => d.weekday)).toEqual([0, 3])
    expect(days[0]).toMatchObject({ n: 3 })
    expect(days[0]?.avg).toBeCloseTo(14 / 3)
  })

  it('breaks ties by more ratings, then the earlier weekday', () => {
    const checkIns = [...rows(9, 5, 4, 4, 4), ...rows(9, 2, 4, 4, 4), ...rows(9, 6, 4, 4, 4, 4)]
    expect(bestWeekdays(checkIns).map((d) => d.weekday)).toEqual([6, 2, 5])
  })

  it('ignores weekdays outside 0-6', () => {
    const junk = rows(9, 7, 5, 5, 5)
    expect(bestWeekdays(junk)).toEqual([])
  })
})

describe('suggestHardTaskSlots', () => {
  it('is empty until one weekday and hour together has three ratings', () => {
    // Tuesday 9 twice and Thursday 9 once: three ratings at hour 9, but no single slot has three.
    const checkIns = [...rows(9, 2, 5, 5), ...rows(9, 4, 5)]
    expect(suggestHardTaskSlots(checkIns)).toEqual([])
  })

  it('ranks slots by mean rating', () => {
    const checkIns = [
      ...rows(9, 2, 5, 5, 4), // Tue 9: 4.67
      ...rows(9, 4, 3, 3, 3), // Thu 9: 3.0
      ...rows(19, 2, 4, 4, 4), // Tue 19: 4.0
      ...rows(19, 5, 5, 5), // Fri 19: only two
    ]
    expect(suggestHardTaskSlots(checkIns).map((s) => [s.weekday, s.hour])).toEqual([
      [2, 9],
      [2, 19],
      [4, 9],
    ])
    expect(suggestHardTaskSlots(checkIns, { limit: 1 })).toHaveLength(1)
  })

  it('does not mix up a weekday and an hour that share a number', () => {
    // Weekday 1, hour 2 and weekday 2, hour 1 are different slots.
    const checkIns = [...rows(2, 1, 5, 5, 5), ...rows(1, 2, 4, 4, 4)]
    expect(suggestHardTaskSlots(checkIns)).toEqual([
      { weekday: 1, hour: 2, avg: 5, n: 3 },
      { weekday: 2, hour: 1, avg: 4, n: 3 },
    ])
  })
})

describe('topFocusHour', () => {
  it('is null while nothing has enough ratings, then the best hour', () => {
    expect(topFocusHour([])).toBeNull()
    expect(topFocusHour(rows(9, 1, 5, 5))).toBeNull()
    const checkIns = [...rows(9, 1, 4, 4, 4), ...rows(20, 1, 5, 5, 5)]
    expect(topFocusHour(checkIns)).toBe(20)
  })

  it('can be asked for a different minimum', () => {
    expect(topFocusHour(rows(9, 1, 5, 5), 2)).toBe(9)
  })
})

describe('hourLabel and weekdayName', () => {
  it('writes hours the way a person says them', () => {
    expect([0, 1, 9, 11, 12, 13, 18, 23].map(hourLabel)).toEqual([
      '12 AM',
      '1 AM',
      '9 AM',
      '11 AM',
      '12 PM',
      '1 PM',
      '6 PM',
      '11 PM',
    ])
  })

  it('names weekdays from Sunday = 0, long or short', () => {
    expect(weekdayName(0)).toBe('Sunday')
    expect(weekdayName(2)).toBe('Tuesday')
    expect(weekdayName(6, 'short')).toBe('Sat')
    expect(weekdayName(7)).toBe('Sunday')
  })
})
