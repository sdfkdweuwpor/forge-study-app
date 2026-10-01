// Runs with TZ=America/New_York. DST 2026: starts Sun Mar 8, ends Sun Nov 1. 2027 starts Mar 14.
import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  atTime,
  compareISODate,
  dayEndMs,
  dayOf,
  dayStartMs,
  diffDays,
  eachDay,
  endOfWeekISO,
  fromISODate,
  hourOf,
  isHHmm,
  isInAnyRange,
  isInRange,
  isISODate,
  maxISODate,
  minISODate,
  minutesOfDay,
  nextDayStartMs,
  parseHHmm,
  startOfWeekISO,
  toHHmm,
  toISODate,
  weekdayOf,
} from '@/logic/dates'

const HOUR = 3_600_000

describe('parsing and formatting', () => {
  it('validates ISODate strings', () => {
    expect(isISODate('2026-09-29')).toBe(true)
    expect(isISODate('2028-02-29')).toBe(true)
    for (const bad of [
      '2026-02-30',
      '2026-13-01',
      '2026-9-29',
      '26-09-29',
      '2026-09-29T00:00',
      '',
      42,
      null,
    ]) {
      expect(isISODate(bad)).toBe(false)
    }
  })

  it('parses to local midnight, not UTC', () => {
    const d = fromISODate('2026-09-29')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 8, 29, 0, 0,
    ])
    // The trap we avoid: new Date('2026-09-29') is Sept 28, 20:00 in New York.
    expect(toISODate(new Date('2026-09-29'))).toBe('2026-09-28')
    expect(toISODate(fromISODate('2026-09-29'))).toBe('2026-09-29')
  })

  it('throws on malformed days', () => {
    expect(() => fromISODate('2026-02-30')).toThrow(RangeError)
  })

  it('maps instants to their local day around midnight', () => {
    const lateNight = new Date(2026, 8, 29, 23, 59, 59).getTime()
    expect(dayOf(lateNight)).toBe('2026-09-29')
    expect(dayOf(lateNight + 1000)).toBe('2026-09-30')
    // 02:30 UTC on Sept 30 is still Sept 29 in New York.
    expect(dayOf(Date.UTC(2026, 8, 30, 2, 30))).toBe('2026-09-29')
  })
})

describe('calendar arithmetic across DST', () => {
  it('adds days across spring-forward and fall-back', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
    expect(addDays('2026-11-02', -2)).toBe('2026-10-31')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-03-15', -365)).toBe('2026-03-15')
  })

  it('diffs whole calendar days regardless of 23h/25h days', () => {
    expect(diffDays('2026-03-09', '2026-03-08')).toBe(1)
    expect(diffDays('2026-03-09', '2026-03-07')).toBe(2)
    expect(diffDays('2026-11-02', '2026-10-31')).toBe(2)
    expect(diffDays('2026-10-31', '2026-11-02')).toBe(-2)
    expect(diffDays('2027-03-14', '2026-03-08')).toBe(371)
    expect(diffDays('2026-09-29', '2026-09-29')).toBe(0)
  })

  it('eachDay has no duplicate or missing days across both 2026 transitions and 2027', () => {
    const days = eachDay('2026-03-01', '2027-03-31')
    expect(days).toHaveLength(diffDays('2027-03-31', '2026-03-01') + 1)
    expect(new Set(days).size).toBe(days.length)
    for (let i = 1; i < days.length; i++) {
      expect(diffDays(days[i] as string, days[i - 1] as string)).toBe(1)
    }
    expect(days).toContain('2026-03-08')
    expect(days).toContain('2026-11-01')
    expect(days).toContain('2027-03-14')
    expect(eachDay('2026-09-30', '2026-09-29')).toEqual([])
    expect(eachDay('2026-09-29', '2026-09-29')).toEqual(['2026-09-29'])
  })

  it('adds months and clamps month ends (WGU 6-month terms)', () => {
    expect(addMonths('2026-10-01', 6)).toBe('2027-04-01')
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28')
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29')
  })

  it('compares, mins and maxes', () => {
    expect(compareISODate('2026-09-29', '2026-10-01')).toBe(-1)
    expect(compareISODate('2026-10-01', '2026-09-29')).toBe(1)
    expect(compareISODate('2026-10-01', '2026-10-01')).toBe(0)
    expect(minISODate('2026-10-01', '2026-09-29', '2027-01-01')).toBe('2026-09-29')
    expect(maxISODate('2026-10-01', '2026-09-29', '2027-01-01')).toBe('2027-01-01')
  })
})

describe('weeks and ranges', () => {
  it('knows weekdays (0 = Sunday)', () => {
    expect(weekdayOf('2026-09-27')).toBe(0)
    expect(weekdayOf('2026-09-29')).toBe(2)
    expect(weekdayOf('2026-03-08')).toBe(0)
  })

  it('computes week bounds for Monday and Sunday starts', () => {
    expect(startOfWeekISO('2026-09-29', 1)).toBe('2026-09-28')
    expect(endOfWeekISO('2026-09-29', 1)).toBe('2026-10-04')
    expect(startOfWeekISO('2026-09-29', 0)).toBe('2026-09-27')
    expect(startOfWeekISO('2026-09-27', 1)).toBe('2026-09-21')
    // A week containing fall-back.
    expect(startOfWeekISO('2026-11-01', 1)).toBe('2026-10-26')
    expect(endOfWeekISO('2026-11-01', 0)).toBe('2026-11-07')
  })

  it('checks inclusive ranges', () => {
    const r = { start: '2026-12-20', end: '2027-01-02', label: 'Holidays' }
    expect(isInRange('2026-12-20', r)).toBe(true)
    expect(isInRange('2027-01-02', r)).toBe(true)
    expect(isInRange('2027-01-03', r)).toBe(false)
    expect(isInAnyRange('2026-11-26', [r, { start: '2026-11-26', end: '2026-11-27' }])).toBe(true)
    expect(isInAnyRange('2026-11-25', [r])).toBe(false)
  })
})

describe('instants', () => {
  it('has 23h, 24h and 25h days', () => {
    expect(dayEndMs('2026-03-08') - dayStartMs('2026-03-08')).toBe(23 * HOUR)
    expect(dayEndMs('2026-09-29') - dayStartMs('2026-09-29')).toBe(24 * HOUR)
    expect(dayEndMs('2026-11-01') - dayStartMs('2026-11-01')).toBe(25 * HOUR)
    expect(dayEndMs('2027-03-14') - dayStartMs('2027-03-14')).toBe(23 * HOUR)
  })

  it('finds the next local midnight', () => {
    const now = new Date(2026, 9, 31, 22, 0).getTime()
    expect(nextDayStartMs(now)).toBe(new Date(2026, 10, 1).getTime())
    // During the repeated 01:xx hour on fall-back day, the next midnight is 23 wall-clock hours on.
    const repeated = new Date(2026, 10, 1, 1, 30).getTime()
    expect(dayOf(nextDayStartMs(repeated))).toBe('2026-11-02')
    expect(dayOf(nextDayStartMs(repeated) - 1)).toBe('2026-11-01')
  })

  it('builds wall-clock instants, including on DST days', () => {
    const t = atTime('2026-09-29', '14:00')
    expect(hourOf(t)).toBe(14)
    expect(dayOf(t)).toBe('2026-09-29')
    expect(minutesOfDay(atTime('2026-11-01', '09:15'))).toBe(9 * 60 + 15)
    expect(atTime('2026-11-01', '09:00') - dayStartMs('2026-11-01')).toBe(10 * HOUR)
    // 02:30 doesn't exist on spring-forward day; it resolves forward and stays on the same day.
    const gap = atTime('2026-03-08', '02:30')
    expect(dayOf(gap)).toBe('2026-03-08')
    expect(hourOf(gap)).toBe(3)
    expect(() => atTime('2026-09-29', '24:00')).toThrow(RangeError)
  })

  it('parses and formats HH:mm', () => {
    expect(isHHmm('09:05')).toBe(true)
    expect(isHHmm('9:05')).toBe(false)
    expect(isHHmm('23:60')).toBe(false)
    expect(parseHHmm('14:30')).toBe(870)
    expect(parseHHmm('nope')).toBeNull()
    expect(toHHmm(870)).toBe('14:30')
    expect(toHHmm(0)).toBe('00:00')
    expect(toHHmm(1440 + 5)).toBe('00:05')
    expect(toHHmm(-15)).toBe('23:45')
  })
})
