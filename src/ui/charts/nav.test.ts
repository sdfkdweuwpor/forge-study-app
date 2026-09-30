import { describe, expect, it } from 'vitest'
import { navTarget, type NavOptions } from './nav'

const bars: NavOptions = {
  count: 5,
  initial: 4,
  deltas: { ArrowLeft: -1, ArrowRight: 1 },
}

describe('navTarget', () => {
  it('moves one datum with the arrows', () => {
    expect(navTarget('ArrowLeft', 3, bars)).toBe(2)
    expect(navTarget('ArrowRight', 3, bars)).toBe(4)
  })

  it('stays at an edge instead of wrapping', () => {
    expect(navTarget('ArrowLeft', 0, bars)).toBe(0)
    expect(navTarget('ArrowRight', 4, bars)).toBe(4)
  })

  it('lands on the initial datum when nothing is active', () => {
    expect(navTarget('ArrowLeft', null, bars)).toBe(4)
    expect(navTarget('ArrowRight', null, bars)).toBe(4)
    expect(navTarget('Home', null, bars)).toBe(0)
  })

  it('jumps with Home and End', () => {
    expect(navTarget('Home', 3, bars)).toBe(0)
    expect(navTarget('End', 1, bars)).toBe(4)
  })

  it('ignores keys the chart does not use', () => {
    expect(navTarget('ArrowUp', 2, bars)).toBeNull()
    expect(navTarget('a', 2, bars)).toBeNull()
    expect(navTarget('Enter', 2, bars)).toBeNull()
    expect(navTarget('ArrowLeft', 2, { ...bars, deltas: { ArrowLeft: 0 } })).toBeNull()
  })

  it('does nothing for an empty chart', () => {
    expect(navTarget('ArrowLeft', null, { ...bars, count: 0 })).toBeNull()
  })

  it('recovers when the active index is stale after the data shrank', () => {
    expect(navTarget('ArrowLeft', 9, bars)).toBe(4)
  })

  describe('a week grid (columns are weeks of 7 days)', () => {
    // 3 weeks; the last two days of the last week have not happened.
    const grid: NavOptions = {
      count: 21,
      initial: 18,
      deltas: { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 },
      enabled: (i) => i <= 18,
    }

    it('moves a week sideways and a day up or down', () => {
      expect(navTarget('ArrowLeft', 10, grid)).toBe(3)
      expect(navTarget('ArrowRight', 10, grid)).toBe(17)
      expect(navTarget('ArrowUp', 10, grid)).toBe(9)
      expect(navTarget('ArrowDown', 10, grid)).toBe(11)
    })

    it('never selects a day that has not happened', () => {
      expect(navTarget('ArrowDown', 18, grid)).toBe(18)
      expect(navTarget('ArrowRight', 12, grid)).toBe(12) // 19 is future, 26 is past the end
      expect(navTarget('End', 3, grid)).toBe(18)
    })

    it('starts on today', () => {
      expect(navTarget('ArrowLeft', null, grid)).toBe(18)
    })

    it('falls back to the nearest usable datum when the initial one is disabled', () => {
      expect(navTarget('ArrowLeft', null, { ...grid, initial: 20 })).toBe(18)
    })
  })
})
