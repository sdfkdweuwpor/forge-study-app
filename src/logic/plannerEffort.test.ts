import { describe, expect, it } from 'vitest'
import { courseBaseMinutes, effortLabel, parseHoursInput, resolveEffort } from './plannerEffort'

describe('courseBaseMinutes', () => {
  it('uses hours, or CUs times the multiplier', () => {
    expect(courseBaseMinutes({ hours: 40, cus: 4, effortBy: 'hours' })).toBe(2400)
    expect(courseBaseMinutes({ hours: 40, cus: 4, effortBy: 'cus', multiplier: 12 })).toBe(2880)
    expect(courseBaseMinutes({ hours: null, cus: 3, effortBy: 'hours' })).toBe(2700)
    expect(courseBaseMinutes({ hours: 5, cus: null, effortBy: 'cus' })).toBe(300)
    expect(courseBaseMinutes({ hours: null, cus: null, effortBy: 'hours' })).toBeNull()
  })
})

describe('resolveEffort', () => {
  it('shares a course budget among units and scales by the rating', () => {
    const r = resolveEffort(2400, 'new', [
      { baseMinutes: null, rating: null },
      { baseMinutes: null, rating: null },
      { baseMinutes: null, rating: null },
      { baseMinutes: null, rating: null },
    ])
    expect(r.units.map((u) => u.minutes)).toEqual([600, 600, 600, 600])
    expect(r.totalMinutes).toBe(2400)
    const known = resolveEffort(2400, 'know', [
      { baseMinutes: null, rating: null },
      { baseMinutes: null, rating: 'new' },
    ])
    expect(known.units.map((u) => u.minutes)).toEqual([600, 1200])
  })

  it('keeps a unit estimate and shares the rest', () => {
    const r = resolveEffort(600, 'new', [
      { baseMinutes: 120, rating: null },
      { baseMinutes: null, rating: null },
      { baseMinutes: null, rating: null },
    ])
    expect(r.units.map((u) => u.baseMinutes)).toEqual([120, 240, 240])
  })

  it('sums explicit units when every unit has one', () => {
    const r = resolveEffort(9999, 'somewhat', [
      { baseMinutes: 150, rating: null },
      { baseMinutes: 90, rating: null },
    ])
    expect(r.totalBaseMinutes).toBe(240)
    expect(r.totalMinutes).toBe(120 + 75)
  })

  it('treats a course without units as one session-sized block', () => {
    expect(resolveEffort(3000, 'somewhat', []).totalMinutes).toBe(2400)
    expect(resolveEffort(null, 'new', []).totalMinutes).toBe(0)
  })
})

describe('parseHoursInput and effortLabel', () => {
  it('reads common ways of typing time', () => {
    expect(parseHoursInput('1.5')).toBe(90)
    expect(parseHoursInput('1,5')).toBe(90)
    expect(parseHoursInput('90m')).toBe(90)
    expect(parseHoursInput('2 h')).toBe(120)
    expect(parseHoursInput('1h30')).toBe(90)
    expect(parseHoursInput('')).toBeNull()
    expect(parseHoursInput('abc')).toBeNull()
  })
  it('labels minutes', () => {
    expect(effortLabel(0)).toBe('—')
    expect(effortLabel(45)).toBe('45 min')
    expect(effortLabel(150)).toBe('2 h 30 min')
    expect(effortLabel(120)).toBe('2 h')
  })
})
