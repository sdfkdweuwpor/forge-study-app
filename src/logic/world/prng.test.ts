import { describe, expect, it } from 'vitest'
import { chance, int, mulberry32, pick } from './prng'

describe('mulberry32', () => {
  it('matches the reference vector for seed 1', () => {
    const rng = mulberry32(1)
    expect(rng()).toBeCloseTo(0.6270739406, 9)
    expect(rng()).toBeCloseTo(0.0027357212, 9)
    expect(rng()).toBeCloseTo(0.52744704, 9)
  })

  it('is deterministic and independent per generator', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(mulberry32(43)()).not.toBe(mulberry32(42)())
  })

  it('returns floats in [0, 1)', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('helpers', () => {
  it('int stays in range and reaches both ends', () => {
    const rng = mulberry32(3)
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) {
      const v = int(rng, 2, 5)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(2)
      expect(v).toBeLessThanOrEqual(5)
      seen.add(v)
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5])
  })

  it('pick returns an element of the list', () => {
    const rng = mulberry32(9)
    const list = ['a', 'b', 'c']
    for (let i = 0; i < 1000; i++) expect(list).toContain(pick(rng, list))
  })

  it('pick refuses an empty list', () => {
    expect(() => pick(mulberry32(1), [])).toThrow()
  })

  it('chance follows its probability', () => {
    const rng = mulberry32(11)
    let hits = 0
    for (let i = 0; i < 1000; i++) if (chance(rng, 0.25)) hits += 1
    expect(hits).toBeGreaterThan(190)
    expect(hits).toBeLessThan(310)
    expect(chance(mulberry32(1), 0)).toBe(false)
    expect(chance(mulberry32(1), 1)).toBe(true)
  })
})
