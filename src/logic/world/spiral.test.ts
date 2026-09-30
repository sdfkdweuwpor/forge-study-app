import { describe, expect, it } from 'vitest'
import { spiral } from './spiral'

describe('spiral', () => {
  it('starts with the specified 13 plots', () => {
    const first13 = Array.from({ length: 13 }, (_, n) => spiral(n))
    expect(first13).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: -1, y: 1 },
      { x: -1, y: 0 },
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: 2, y: -1 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ])
  })

  it('never returns a negative zero', () => {
    for (let n = 0; n < 500; n++) {
      const { x, y } = spiral(n)
      expect(Object.is(x, -0)).toBe(false)
      expect(Object.is(y, -0)).toBe(false)
    }
  })

  it('is unique for n < 2000', () => {
    const seen = new Set<string>()
    for (let n = 0; n < 2000; n++) {
      const { x, y } = spiral(n)
      seen.add(`${x},${y}`)
    }
    expect(seen.size).toBe(2000)
  })

  it('walks ring r at Chebyshev distance r, one step at a time', () => {
    for (let r = 1; r <= 12; r++) {
      const start = (2 * r - 1) ** 2
      expect(spiral(start)).toEqual({ x: r, y: 1 - r })
      for (let i = 0; i < 8 * r; i++) {
        const { x, y } = spiral(start + i)
        expect(Math.max(Math.abs(x), Math.abs(y))).toBe(r)
        const next = spiral(start + i + 1)
        expect(Math.abs(next.x - x) + Math.abs(next.y - y)).toBeLessThanOrEqual(
          // the last cell of a ring steps out to the first of the next ring: one step right and one down... or up
          i === 8 * r - 1 ? 2 : 1,
        )
      }
      // The ring ends at its top-right corner and the next one starts just to the right of it.
      expect(spiral(start + 8 * r - 1)).toEqual({ x: r, y: -r })
    }
  })

  it('is cheap for a huge n and rejects bad input', () => {
    expect(spiral(4_000_000)).toBeDefined()
    expect(() => spiral(-1)).toThrow(RangeError)
    expect(() => spiral(1.5)).toThrow(RangeError)
  })
})
