import { describe, expect, it } from 'vitest'
import {
  availabilityFromGoal,
  clampSession,
  copyDayTo,
  defaultAvailability,
  defaultShift,
  nextWindow,
  setDayWindows,
  shiftDays,
  shiftFromPattern,
  shiftToPattern,
  studyDaysPerWeek,
  toAvailabilityV2,
  toGoalAvailability,
  validateAvailability,
  weeklyWindowMinutes,
  windowProblem,
  withExtraMinutes,
} from './plannerAvailability'
import { capacityForDate } from './scheduler'

describe('windows', () => {
  it('flags bad windows', () => {
    expect(windowProblem({ start: '18:00', end: '20:00' })).toBeNull()
    expect(windowProblem({ start: '20:00', end: '18:00' })).toMatch(/after the start/)
    expect(windowProblem({ start: '18:00', end: '18:10' })).toMatch(/25 minutes/)
  })
  it('adds the next window after the last one', () => {
    expect(nextWindow([])).toEqual({ start: '18:00', end: '20:00' })
    expect(nextWindow([{ start: '09:00', end: '11:00' }])).toEqual({ start: '12:00', end: '13:00' })
  })
  it('copies a day to the weekdays or to every day', () => {
    const av = setDayWindows(defaultAvailability(), 6, [{ start: '10:00', end: '12:00' }])
    const wk = copyDayTo(av, 6, 'weekdays')
    expect(wk.weekly[1]).toEqual([{ start: '10:00', end: '12:00' }])
    expect(wk.weekly[0]).toEqual([])
    expect(copyDayTo(av, 6, 'all').weekly[0]).toEqual([{ start: '10:00', end: '12:00' }])
  })
  it('keeps a session length between 25 and 90 in steps of 5', () => {
    expect(clampSession(10)).toBe(25)
    expect(clampSession(200)).toBe(90)
    expect(clampSession(52)).toBe(50)
  })
})

describe('summaries', () => {
  it('adds up the week', () => {
    // Mon–Fri 2 h + Sat 3 h.
    expect(weeklyWindowMinutes(defaultAvailability())).toBe(5 * 120 + 180)
    expect(studyDaysPerWeek(defaultAvailability())).toBe(6)
  })
  it('averages a shift cycle over a week', () => {
    const av = { ...defaultAvailability(), shift: defaultShift('2026-10-05') }
    // 3 on (1.5 h) + 4 off (5 h) over 7 days = 24.5 h a week.
    expect(weeklyWindowMinutes(av)).toBe(90 * 3 + 300 * 4)
    expect(studyDaysPerWeek(av)).toBe(7)
  })
  it('asks for a window and for good ranges', () => {
    const empty = { ...defaultAvailability(), weekly: [[], [], [], [], [], [], []] }
    expect(validateAvailability(empty).days).toBeTruthy()
    const bad = {
      ...defaultAvailability(),
      blackouts: [
        { key: 'b', start: '2026-12-24' as const, end: '2026-12-20' as const, label: '' },
      ],
    }
    expect(validateAvailability(bad)['blackout:b']).toMatch(/before the start/)
  })
})

describe('shift patterns', () => {
  it('builds the cycle and reads it back', () => {
    const shift = { ...defaultShift('2026-10-05'), preset: '2-2-3' as const }
    const pattern = shiftToPattern(shift)
    expect(pattern.cycle).toHaveLength(14)
    expect(shiftDays('2-2-3').filter(Boolean)).toHaveLength(7)
    expect(shiftFromPattern(pattern)).toEqual(shift)
  })
  it('makes windows per day from the anchor', () => {
    const av = { ...defaultAvailability(), shift: defaultShift('2026-10-05') }
    const v2 = toAvailabilityV2(av)
    expect(capacityForDate(v2, '2026-10-05')).toEqual([{ start: '19:00', end: '20:30' }])
    expect(capacityForDate(v2, '2026-10-08')).toHaveLength(2)
    expect(capacityForDate(v2, '2026-10-12')).toEqual([{ start: '19:00', end: '20:30' }])
  })
})

describe('draft ↔ goal', () => {
  it('round-trips through the goal fields', () => {
    const av = {
      ...defaultAvailability(),
      blackouts: [
        { key: 'b', start: '2026-12-20' as const, end: '2026-12-27' as const, label: 'Holidays' },
      ],
      shift: defaultShift('2026-10-05'),
    }
    const stored = toGoalAvailability(av)
    expect(stored.availability.daysOff).toEqual([
      { start: '2026-12-20', end: '2026-12-27', label: 'Holidays' },
    ])
    let n = 0
    const back = availabilityFromGoal(
      {
        availability: stored.availability,
        planning: {
          ...stored.planning,
          bufferPct: 0.12,
          cuHoursMultiplier: 15,
          asap: false,
          paceMinutesPerStudyDay: null,
        },
      },
      () => `k${++n}`,
    )
    expect(back.shift).toEqual(av.shift)
    expect(back.weekly).toEqual(av.weekly)
    expect(back.blackouts[0]?.label).toBe('Holidays')
  })
})

describe('withExtraMinutes', () => {
  it('lengthens every study day, weekly and shift alike', () => {
    const av = { ...defaultAvailability(), shift: defaultShift('2026-10-05') }
    const more = withExtraMinutes(av, 25)
    expect(more.weekly[1]).toEqual([{ start: '18:00', end: '20:25' }])
    expect(more.weekly[0]).toEqual([])
    expect(more.shift?.onWindows).toEqual([{ start: '19:00', end: '20:55' }])
    expect(weeklyWindowMinutes(withExtraMinutes(defaultAvailability(), 25))).toBe(
      weeklyWindowMinutes(defaultAvailability()) + 6 * 25,
    )
  })
})
