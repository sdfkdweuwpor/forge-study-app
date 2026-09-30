import { describe, expect, it } from 'vitest'
import type { ScheduleWindow } from './protocol.js'
import { isScheduleActive, minutesOfDay, nextScheduleBoundary } from './schedule.js'

// Tests run with TZ=America/New_York. Months are 0-based; Sep 30 2026 is a Wednesday.
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo, d, h, mi).getTime()

const SUN = 0
const MON = 1
const TUE = 2
const WED = 3
const SAT = 6

describe('minutesOfDay', () => {
  it('parses HH:mm', () => {
    expect(minutesOfDay('00:00')).toBe(0)
    expect(minutesOfDay('09:30')).toBe(570)
    expect(minutesOfDay('23:59')).toBe(1439)
    expect(minutesOfDay('24:00')).toBeNull()
    expect(minutesOfDay('9:30')).toBeNull()
  })
})

describe('isScheduleActive: same-day windows', () => {
  const workdays: ScheduleWindow[] = [{ days: [MON, TUE, WED, 4, 5], start: '09:00', end: '17:00' }]

  it('is active inside the window, on a listed day', () => {
    expect(isScheduleActive(workdays, local(2026, 8, 30, 12, 0))).toBe(true) // Wed
    expect(isScheduleActive(workdays, local(2026, 8, 30, 9, 0))).toBe(true) // start is inclusive
  })

  it('is inactive outside it, and at its end', () => {
    expect(isScheduleActive(workdays, local(2026, 8, 30, 8, 59))).toBe(false)
    expect(isScheduleActive(workdays, local(2026, 8, 30, 17, 0))).toBe(false) // end is exclusive
    expect(isScheduleActive(workdays, local(2026, 8, 30, 18, 0))).toBe(false)
  })

  it('is inactive on days that are not listed', () => {
    expect(isScheduleActive(workdays, local(2026, 9, 3, 12, 0))).toBe(false) // Sat Oct 3
    expect(isScheduleActive(workdays, local(2026, 9, 4, 12, 0))).toBe(false) // Sun Oct 4
  })

  it('an empty schedule and an equal start/end never block', () => {
    expect(isScheduleActive([], local(2026, 8, 30, 12, 0))).toBe(false)
    expect(isScheduleActive([{ days: [WED], start: '09:00', end: '09:00' }], local(2026, 8, 30, 9, 0))).toBe(false)
  })

  it('ignores a malformed window instead of throwing', () => {
    expect(isScheduleActive([{ days: [WED], start: 'nine', end: '17:00' }], local(2026, 8, 30, 12, 0))).toBe(false)
  })

  it('combines several windows', () => {
    const two: ScheduleWindow[] = [
      { days: [WED], start: '06:00', end: '08:00' },
      { days: [WED], start: '19:00', end: '21:00' },
    ]
    expect(isScheduleActive(two, local(2026, 8, 30, 7, 0))).toBe(true)
    expect(isScheduleActive(two, local(2026, 8, 30, 12, 0))).toBe(false)
    expect(isScheduleActive(two, local(2026, 8, 30, 20, 0))).toBe(true)
  })
})

describe('isScheduleActive: overnight windows belong to the day they start on', () => {
  const tuesdayNight: ScheduleWindow[] = [{ days: [TUE], start: '22:00', end: '06:00' }]

  it('covers the evening of the listed day', () => {
    expect(isScheduleActive(tuesdayNight, local(2026, 8, 29, 22, 0))).toBe(true) // Tue Sep 29
    expect(isScheduleActive(tuesdayNight, local(2026, 8, 29, 23, 30))).toBe(true)
  })

  it('covers the small hours of the NEXT day (Tue 22:00-06:00 covers Wed 04:30)', () => {
    expect(isScheduleActive(tuesdayNight, local(2026, 8, 30, 0, 0))).toBe(true) // Wed
    expect(isScheduleActive(tuesdayNight, local(2026, 8, 30, 4, 30))).toBe(true)
    expect(isScheduleActive(tuesdayNight, local(2026, 8, 30, 5, 59))).toBe(true)
  })

  it('ends at the end time, and does not cover the listed day itself in the morning', () => {
    expect(isScheduleActive(tuesdayNight, local(2026, 8, 30, 6, 0))).toBe(false) // Wed 06:00
    expect(isScheduleActive(tuesdayNight, local(2026, 8, 29, 4, 30))).toBe(false) // Tue 04:30 belongs to Monday
    expect(isScheduleActive(tuesdayNight, local(2026, 8, 29, 14, 0))).toBe(false)
    expect(isScheduleActive(tuesdayNight, local(2026, 8, 30, 23, 30))).toBe(false) // Wed night: Wed is not listed
  })

  it('crosses a month boundary', () => {
    const wed: ScheduleWindow[] = [{ days: [WED], start: '22:00', end: '06:00' }]
    // Wed Sep 30 22:00 -> Thu Oct 1 06:00
    expect(isScheduleActive(wed, local(2026, 8, 30, 23, 0))).toBe(true)
    expect(isScheduleActive(wed, local(2026, 9, 1, 5, 0))).toBe(true)
    expect(isScheduleActive(wed, local(2026, 9, 1, 6, 0))).toBe(false)
  })
})

describe('isScheduleActive: daylight saving (America/New_York)', () => {
  // Spring forward: Sun Mar 8 2026, 02:00 EST -> 03:00 EDT. The Saturday window is 7 real hours long.
  const saturdayNight: ScheduleWindow[] = [{ days: [SAT], start: '22:00', end: '06:00' }]

  it('stays active across the spring-forward gap and ends at 06:00 local', () => {
    expect(isScheduleActive(saturdayNight, local(2026, 2, 7, 23, 0))).toBe(true)
    expect(isScheduleActive(saturdayNight, local(2026, 2, 8, 1, 59))).toBe(true)
    expect(isScheduleActive(saturdayNight, local(2026, 2, 8, 3, 0))).toBe(true) // first minute after the jump
    expect(isScheduleActive(saturdayNight, local(2026, 2, 8, 5, 59))).toBe(true)
    expect(isScheduleActive(saturdayNight, local(2026, 2, 8, 6, 0))).toBe(false)
  })

  it('fall back: Sun Nov 1 2026 has a 25-hour day and the window still ends at 06:00 local', () => {
    expect(isScheduleActive(saturdayNight, local(2026, 10, 1, 5, 59))).toBe(true)
    expect(isScheduleActive(saturdayNight, local(2026, 10, 1, 6, 0))).toBe(false)
    // 01:30 happens twice; both instants are inside the window.
    const first0130 = Date.UTC(2026, 10, 1, 5, 30) // 01:30 EDT
    const second0130 = Date.UTC(2026, 10, 1, 6, 30) // 01:30 EST
    expect(isScheduleActive(saturdayNight, first0130)).toBe(true)
    expect(isScheduleActive(saturdayNight, second0130)).toBe(true)
  })

  it('a daytime window on the switch day keeps its wall-clock hours', () => {
    const sunday: ScheduleWindow[] = [{ days: [SUN], start: '09:00', end: '17:00' }]
    expect(isScheduleActive(sunday, local(2026, 2, 8, 8, 59))).toBe(false)
    expect(isScheduleActive(sunday, local(2026, 2, 8, 9, 0))).toBe(true)
    expect(isScheduleActive(sunday, local(2026, 2, 8, 16, 59))).toBe(true)
    expect(isScheduleActive(sunday, local(2026, 2, 8, 17, 0))).toBe(false)
  })
})

describe('nextScheduleBoundary', () => {
  const workdays: ScheduleWindow[] = [{ days: [MON, TUE, WED, 4, 5], start: '09:00', end: '17:00' }]

  it('is the next start when outside a window', () => {
    expect(nextScheduleBoundary(workdays, local(2026, 8, 30, 7, 0))).toBe(local(2026, 8, 30, 9, 0))
  })

  it('is the end when inside a window', () => {
    expect(nextScheduleBoundary(workdays, local(2026, 8, 30, 12, 0))).toBe(local(2026, 8, 30, 17, 0))
  })

  it('skips to the next listed day (Fri evening -> Mon 09:00)', () => {
    expect(nextScheduleBoundary(workdays, local(2026, 9, 2, 18, 0))).toBe(local(2026, 9, 5, 9, 0)) // Fri Oct 2 -> Mon Oct 5
  })

  it('finds the end of an overnight window that started yesterday', () => {
    const night: ScheduleWindow[] = [{ days: [TUE], start: '22:00', end: '06:00' }]
    expect(nextScheduleBoundary(night, local(2026, 8, 30, 4, 30))).toBe(local(2026, 8, 30, 6, 0))
  })

  it('uses wall-clock time across a DST change', () => {
    const sunday: ScheduleWindow[] = [{ days: [SUN], start: '09:00', end: '17:00' }]
    // From Sat Mar 7 noon the next boundary is Sun Mar 8 09:00 local, which is EDT by then (13:00 UTC).
    expect(nextScheduleBoundary(sunday, local(2026, 2, 7, 12, 0))).toBe(Date.UTC(2026, 2, 8, 13, 0))
  })

  it('is null for an empty schedule', () => {
    expect(nextScheduleBoundary([], local(2026, 8, 30, 12, 0))).toBeNull()
  })
})
