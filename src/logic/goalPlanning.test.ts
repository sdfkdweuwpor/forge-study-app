import { describe, expect, it } from 'vitest'
import type { WeekMinutes } from '@/db/types'
import {
  isAsap,
  minutesFromWeekly,
  planningForAvailability,
  weeklyFromMinutes,
} from './goalPlanning'
import { planningFromAvailability } from './schemaV2'

const minutes: WeekMinutes = [0, 60, 60, 90, 60, 60, 120]

describe('goal planning ↔ weekday minutes', () => {
  it('turns minutes into one window per study day from the study start', () => {
    const p = planningFromAvailability({ minutesByWeekday: minutes, daysOff: [] }, null, '18:00')
    expect(p.weekly[0]).toEqual([])
    expect(p.weekly[3]).toEqual([{ start: '18:00', end: '19:30' }])
    expect(p.asap).toBe(true)
    expect(minutesFromWeekly(p.weekly)).toEqual(minutes)
  })

  it('rebuilds only the days whose minutes changed, from where they started', () => {
    const weekly = [
      [],
      [
        { start: '07:00', end: '07:30' },
        { start: '20:00', end: '20:30' },
      ],
      [{ start: '06:00', end: '07:00' }],
      [],
      [],
      [],
      [],
    ]
    const next = weeklyFromMinutes([0, 60, 90, 45, 0, 0, 0], weekly, '09:00')
    expect(next[1]).toEqual(weekly[1]) // still 60: untouched, two windows kept
    expect(next[2]).toEqual([{ start: '06:00', end: '07:30' }])
    expect(next[3]).toEqual([{ start: '09:00', end: '09:45' }])
    // A window never runs past midnight.
    expect(
      weeklyFromMinutes(
        [0, 0, 0, 0, 0, 0, 120],
        [[], [], [], [], [], [], [{ start: '23:00', end: '24:00' }]],
      )[6],
    ).toEqual([{ start: '22:00', end: '24:00' }])
  })

  it('keeps asap as it was when the availability changes', () => {
    const p = planningFromAvailability({ minutesByWeekday: minutes, daysOff: [] }, '2027-01-01')
    expect(p.asap).toBe(false)
    const next = planningForAvailability(
      p,
      { minutesByWeekday: [0, 30, 30, 30, 30, 30, 0], daysOff: [] },
      null,
    )
    expect(next.asap).toBe(false)
    expect(next.weekly[1]).toEqual([{ start: '09:00', end: '09:30' }])
    expect(isAsap({ planning: next, targetDate: null })).toBe(true)
    expect(isAsap({ planning: next, targetDate: '2027-01-01' })).toBe(false)
  })
})
