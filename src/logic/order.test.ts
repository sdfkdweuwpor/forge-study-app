import { describe, expect, it } from 'vitest'
import {
  MIN_ORDER_GAP,
  ORDER_STEP,
  evenOrders,
  isCrowded,
  neighboursAfterStep,
  neighboursAtIndex,
  orderBetween,
} from './order'

describe('orderBetween', () => {
  it('starts an empty list at 0', () => {
    expect(orderBetween(null, null)).toBe(0)
  })

  it('places a row before the first and after the last', () => {
    expect(orderBetween(null, 100)).toBe(100 - ORDER_STEP)
    expect(orderBetween(100, null)).toBe(100 + ORDER_STEP)
  })

  it('places a row halfway between two neighbours', () => {
    expect(orderBetween(1024, 2048)).toBe(1536)
    expect(orderBetween(-5, 5)).toBe(0)
  })

  it('keeps halving without ever landing on a neighbour, until the gap is crowded', () => {
    let above = 0
    const below = ORDER_STEP
    let steps = 0
    while (!isCrowded(above, below)) {
      const mid = orderBetween(above, below)
      expect(mid).toBeGreaterThan(above)
      expect(mid).toBeLessThan(below)
      above = mid
      steps++
    }
    // 1024 / 2^n < 1e-3 after about 20 halvings.
    expect(steps).toBeGreaterThan(15)
    expect(below - above).toBeLessThan(MIN_ORDER_GAP)
  })
})

describe('isCrowded', () => {
  it('is false at the ends of a list and for a healthy gap', () => {
    expect(isCrowded(null, 5)).toBe(false)
    expect(isCrowded(5, null)).toBe(false)
    expect(isCrowded(0, 1)).toBe(false)
  })

  it('is true for a tiny or empty gap, in either direction', () => {
    expect(isCrowded(1, 1)).toBe(true)
    expect(isCrowded(1, 1 + MIN_ORDER_GAP / 2)).toBe(true)
    expect(isCrowded(2, 1)).toBe(false)
  })
})

describe('evenOrders', () => {
  it('numbers rows in even steps', () => {
    expect(evenOrders(3)).toEqual([0, 1024, 2048])
    expect(evenOrders(0)).toEqual([])
    expect(evenOrders(-2)).toEqual([])
  })
})

describe('neighboursAfterStep', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('moving down puts the row between the next two', () => {
    expect(neighboursAfterStep(ids, 'a', 1)).toEqual({ above: 'b', below: 'c' })
    expect(neighboursAfterStep(ids, 'c', 1)).toEqual({ above: 'd', below: null })
  })

  it('moving up puts the row between the previous two', () => {
    expect(neighboursAfterStep(ids, 'c', -1)).toEqual({ above: 'a', below: 'b' })
    expect(neighboursAfterStep(ids, 'b', -1)).toEqual({ above: null, below: 'a' })
  })

  it('returns null at the ends and for unknown ids', () => {
    expect(neighboursAfterStep(ids, 'a', -1)).toBeNull()
    expect(neighboursAfterStep(ids, 'd', 1)).toBeNull()
    expect(neighboursAfterStep(ids, 'z', 1)).toBeNull()
  })
})

describe('neighboursAtIndex', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('describes the list after the drop', () => {
    // Move "a" to index 2 of the resulting list: b, c, a, d.
    expect(neighboursAtIndex(ids, 'a', 2)).toEqual({ above: 'c', below: 'd' })
    // Move "d" to the top.
    expect(neighboursAtIndex(ids, 'd', 0)).toEqual({ above: null, below: 'a' })
    // Move "b" to the end.
    expect(neighboursAtIndex(ids, 'b', 3)).toEqual({ above: 'd', below: null })
  })

  it('clamps out-of-range indexes and ignores unknown ids', () => {
    expect(neighboursAtIndex(ids, 'a', 99)).toEqual({ above: 'd', below: null })
    expect(neighboursAtIndex(ids, 'a', -4)).toEqual({ above: null, below: 'b' })
    expect(neighboursAtIndex(ids, 'z', 1)).toBeNull()
  })
})
