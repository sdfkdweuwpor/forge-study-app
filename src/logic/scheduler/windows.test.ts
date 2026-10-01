import { describe, expect, it } from 'vitest'
import type { Availability } from '@/db/types'
import { addDays } from '../dates'
import { dayNumber } from './capacity'
import {
  bufferMinutesFor,
  clampBufferPct,
  estimateUnitMinutes,
  SELF_RATING_FACTORS,
} from './effort'
import { avail2, MON, weekWin, win } from './plannerFixtures'
import { splitMinutes } from './split'
import {
  addMinutesToWindows,
  capacityForDate,
  dstShiftOn,
  formatClock,
  fromLegacyAvailability,
  largestWindowMinutes,
  normalizeIntervals,
  parseClock,
  SHIFT_PRESETS,
  shiftCycle,
  subtractIntervals,
} from './windows'

describe('clock and intervals', () => {
  it('parses HH:mm including 24:00 and rejects the rest', () => {
    expect(parseClock('00:00')).toBe(0)
    expect(parseClock('18:30')).toBe(1110)
    expect(parseClock('24:00')).toBe(1440)
    expect(parseClock('24:30')).toBeNull()
    expect(parseClock('7:00')).toBeNull()
    expect(formatClock(1110)).toBe('18:30')
    expect(formatClock(1440)).toBe('24:00')
  })

  it('merges, clips and subtracts intervals', () => {
    expect(
      normalizeIntervals([
        [600, 700],
        [650, 800],
        [800, 900],
        [-5, 10],
        [1400, 1500],
      ]),
    ).toEqual([
      [0, 10],
      [600, 900],
      [1400, 1440],
    ])
    expect(
      subtractIntervals(
        [[600, 900]],
        [
          [650, 700],
          [850, 1000],
        ],
      ),
    ).toEqual([
      [600, 650],
      [700, 850],
    ])
    expect(subtractIntervals([[600, 900]], [])).toEqual([[600, 900]])
  })
})

describe('capacityForDate', () => {
  const av = avail2(weekWin(win(['18:00', '20:00'], ['06:30', '07:30']), win(['09:00', '12:00'])), {
    blackouts: [{ start: '2026-10-07', end: '2026-10-08' }],
  })

  it('returns the weekday windows, sorted and merged', () => {
    expect(capacityForDate(av, MON)).toEqual([
      { start: '06:30', end: '07:30' },
      { start: '18:00', end: '20:00' },
    ])
    expect(capacityForDate(av, '2026-10-10')).toEqual([{ start: '09:00', end: '12:00' }])
    expect(capacityForDate(av, '2026-10-11')).toEqual([]) // Sunday
  })

  it('is empty on blackout days', () => {
    expect(capacityForDate(av, '2026-10-07')).toEqual([])
    expect(capacityForDate(av, '2026-10-08')).toEqual([])
    expect(capacityForDate(av, '2026-10-09')).toHaveLength(2)
  })

  it('uses a shift pattern instead of weekdays, wrapping in both directions', () => {
    const on = win(['19:00', '20:00'])
    const off = win(['09:00', '13:00'])
    const pattern = { anchor: '2026-10-10', cycle: shiftCycle(SHIFT_PRESETS['3on4off'], on, off) }
    const withShift = avail2(weekWin(win(['18:00', '20:00'])), { shiftPattern: pattern })
    const kinds = Array.from({ length: 21 }, (_, i) => {
      const d = addDays('2026-10-03', i) // a week before the anchor to two weeks after
      return capacityForDate(withShift, d)[0]?.start === '19:00' ? 'on' : 'off'
    })
    // 2026-10-03 is 7 days before the anchor: cycle day 0 again.
    expect(kinds.join(' ')).toBe(
      'on on on off off off off on on on off off off off on on on off off off off',
    )
  })

  it('builds the 14-day 2-2-3 rotation', () => {
    const cycle = shiftCycle(SHIFT_PRESETS['2-2-3'], null, win(['10:00', '12:00']))
    expect(cycle).toHaveLength(14)
    expect(cycle.map((c) => (c === null ? '.' : 'S')).join('')).toBe('..SS...SS..SSS')
  })
})

describe('DST (America/New_York)', () => {
  it('finds the skipped and the repeated hour, and nothing on ordinary days', () => {
    expect(dstShiftOn(dayNumber('2027-03-14'))).toEqual([120, 180])
    expect(dstShiftOn(dayNumber('2026-11-01'))).toEqual([60, 120])
    expect(dstShiftOn(dayNumber('2026-10-31'))).toBeNull()
    expect(dstShiftOn(dayNumber('2027-03-15'))).toBeNull()
  })

  it('removes that span from the windows on the change days only', () => {
    const night = avail2([win(['00:00', '04:00']), [], [], [], [], [], []])
    expect(capacityForDate(night, '2027-03-14')).toEqual([
      { start: '00:00', end: '02:00' },
      { start: '03:00', end: '04:00' },
    ])
    expect(capacityForDate(night, '2026-11-01')).toEqual([
      { start: '00:00', end: '01:00' },
      { start: '02:00', end: '04:00' },
    ])
    expect(capacityForDate(night, '2026-11-08')).toEqual([{ start: '00:00', end: '04:00' }])
  })
})

describe('legacy availability', () => {
  it('turns minutes per weekday into one window from the study start; days off become blackouts', () => {
    const legacy: Availability = {
      minutesByWeekday: [0, 60, 60, 60, 60, 90, 1500],
      daysOff: [{ start: '2026-12-24', end: '2026-12-26' }],
    }
    const av = fromLegacyAvailability(legacy, { studyStart: '18:00' })
    expect(av.weekly[0]).toEqual([])
    expect(av.weekly[1]).toEqual([{ start: '18:00', end: '19:00' }])
    expect(av.weekly[5]).toEqual([{ start: '18:00', end: '19:30' }])
    expect(av.weekly[6]).toEqual([{ start: '00:00', end: '24:00' }]) // capped at a whole day
    expect(av.blackouts).toEqual(legacy.daysOff)
    expect(av.sessionMinutes).toBe(50)
    // A late start moves earlier so the window still ends by midnight.
    expect(fromLegacyAvailability(legacy, { studyStart: '23:30' }).weekly[1]).toEqual([
      { start: '23:00', end: '24:00' },
    ])
  })

  it('adds time to every study day: later end first, then earlier start', () => {
    const av = avail2(weekWin(win(['18:00', '20:00']), win(['22:30', '24:00'])))
    const more = addMinutesToWindows(av, 45)
    expect(more.weekly[1]).toEqual([{ start: '18:00', end: '20:45' }])
    expect(more.weekly[6]).toEqual([{ start: '21:45', end: '24:00' }])
    expect(more.weekly[0]).toEqual([])
    expect(largestWindowMinutes(more)).toBe(165)
  })
})

describe('effort', () => {
  it('uses hours, else CUs × multiplier, scaled by self-rating', () => {
    expect(estimateUnitMinutes({ hours: 10, selfRating: 'new' })).toBe(600)
    expect(estimateUnitMinutes({ hours: 10, selfRating: 'somewhat' })).toBe(480)
    expect(estimateUnitMinutes({ hours: 10, selfRating: 'know' })).toBe(300)
    expect(estimateUnitMinutes({ cus: 3, cuHoursMultiplier: 15 })).toBe(2700)
    expect(estimateUnitMinutes({ cus: 4, cuHoursMultiplier: 12, selfRating: 'know' })).toBe(1440)
    expect(estimateUnitMinutes({ hours: 2, cus: 4 })).toBe(120) // hours win
    expect(estimateUnitMinutes({ hours: 0.33 })).toBe(20) // rounded up to the grain
    expect(estimateUnitMinutes({})).toBeNull()
    expect(SELF_RATING_FACTORS).toEqual({ know: 0.5, somewhat: 0.8, new: 1 })
  })

  it('clamps the buffer and sizes it on the grain', () => {
    expect(clampBufferPct(undefined)).toBe(0.12)
    expect(clampBufferPct(0.5)).toBe(0.3)
    expect(clampBufferPct(-1)).toBe(0)
    expect(bufferMinutesFor(1000, 0.12)).toBe(120)
    expect(bufferMinutesFor(1010, 0.12)).toBe(125)
    expect(bufferMinutesFor(0, 0.12)).toBe(0)
  })
})

describe('splitting', () => {
  const rules = { target: 50, min: 25, max: 90, grain: 5 }

  it('makes near-equal sessions close to the target, within [min, max]', () => {
    expect(splitMinutes(100, rules)).toEqual([50, 50])
    expect(splitMinutes(120, rules)).toEqual([60, 60])
    expect(splitMinutes(95, rules)).toEqual([50, 45])
    expect(splitMinutes(90, rules)).toEqual([90])
    expect(splitMinutes(110, { ...rules, target: 25 })).toEqual([30, 30, 25, 25])
    expect(splitMinutes(600, { ...rules, target: 90 })).toEqual([90, 85, 85, 85, 85, 85, 85])
  })

  it('keeps a unit shorter than the minimum as one short session', () => {
    expect(splitMinutes(15, rules)).toEqual([15])
    expect(splitMinutes(12, rules)).toEqual([15]) // rounded up to the grain
    expect(splitMinutes(0, rules)).toEqual([])
  })

  it('always sums to the total and stays in bounds (property)', () => {
    for (let total = 5; total <= 2000; total += 5) {
      for (const target of [25, 45, 50, 60, 90]) {
        const pieces = splitMinutes(total, { ...rules, target })
        expect(pieces.reduce((a, b) => a + b, 0)).toBe(total)
        if (total >= 25) for (const p of pieces) expect(p >= 25 && p <= 90).toBe(true)
        expect(Math.max(...pieces) - Math.min(...pieces)).toBeLessThanOrEqual(5)
      }
    }
  })
})
