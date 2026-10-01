import { describe, expect, it } from 'vitest'
import { ringGeometry } from './ringMath'

describe('ringGeometry', () => {
  it('keeps the stroke inside the box', () => {
    const g = ringGeometry(40, 4, 0)
    expect(g.center).toBe(20)
    expect(g.radius).toBe(18)
    expect(g.circumference).toBeCloseTo(2 * Math.PI * 18)
  })

  it('maps value/max to the dash offset', () => {
    const g = ringGeometry(40, 4, 25)
    expect(g.fraction).toBe(0.25)
    expect(g.offset).toBeCloseTo(g.circumference * 0.75)
    expect(ringGeometry(40, 4, 0).offset).toBeCloseTo(ringGeometry(40, 4, 0).circumference)
    expect(ringGeometry(40, 4, 100).offset).toBe(0)
    expect(ringGeometry(120, 8, 3, 4).fraction).toBe(0.75)
  })

  it('clamps out-of-range and invalid input', () => {
    expect(ringGeometry(40, 4, 140).fraction).toBe(1)
    expect(ringGeometry(40, 4, -5).fraction).toBe(0)
    expect(ringGeometry(40, 4, 5, 0).fraction).toBe(0)
    expect(ringGeometry(40, 4, Number.NaN).fraction).toBe(0)
    expect(ringGeometry(4, 10, 50).radius).toBe(0)
  })
})
