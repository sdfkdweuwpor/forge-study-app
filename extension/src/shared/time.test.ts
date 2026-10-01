import { describe, expect, it } from 'vitest'
import { formatClock, localDayKey, secondsLeft } from './time.js'

describe('localDayKey', () => {
  it('formats a local calendar day', () => {
    expect(localDayKey(new Date(2026, 8, 30, 12, 0).getTime())).toBe('2026-09-30')
    expect(localDayKey(new Date(2026, 0, 5, 0, 0).getTime())).toBe('2026-01-05')
  })

  it('does not roll over at 8pm New York, which is midnight UTC', () => {
    const eightThirtyPm = new Date(2026, 8, 29, 20, 30).getTime() // 00:30Z on Sep 30
    expect(new Date(eightThirtyPm).toISOString().slice(0, 10)).toBe('2026-09-30') // what the old code used
    expect(localDayKey(eightThirtyPm)).toBe('2026-09-29')
  })

  it('rolls over at local midnight', () => {
    expect(localDayKey(new Date(2026, 8, 29, 23, 59, 59).getTime())).toBe('2026-09-29')
    expect(localDayKey(new Date(2026, 8, 30, 0, 0, 0).getTime())).toBe('2026-09-30')
  })

  it('has 23 and 25 hour days on DST changes without skipping or repeating a date', () => {
    expect(localDayKey(new Date(2026, 2, 8, 12, 0).getTime())).toBe('2026-03-08')
    expect(localDayKey(new Date(2026, 2, 9, 0, 0).getTime())).toBe('2026-03-09')
    expect(localDayKey(new Date(2026, 10, 1, 23, 30).getTime())).toBe('2026-11-01')
  })
})

describe('secondsLeft / formatClock', () => {
  it('counts from timestamps and rounds up', () => {
    expect(secondsLeft(10_000, 0)).toBe(10)
    expect(secondsLeft(10_000, 9_001)).toBe(1)
    expect(secondsLeft(10_000, 10_000)).toBe(0)
    expect(secondsLeft(10_000, 20_000)).toBe(0)
  })

  it('formats mm:ss and h:mm:ss', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(59)).toBe('00:59')
    expect(formatClock(24 * 60 + 31)).toBe('24:31')
    expect(formatClock(3600 + 5 * 60 + 9)).toBe('1:05:09')
    expect(formatClock(-4)).toBe('00:00')
  })
})
