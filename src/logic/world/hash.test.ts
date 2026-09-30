import { describe, expect, it } from 'vitest'
import { hash32, rngFor } from './hash'
import { mulberry32 } from './prng'

describe('hash32 (FNV-1a)', () => {
  it('matches the reference vectors', () => {
    expect(hash32('abc')).toBe(0x1a47e90b)
    expect(hash32('1337:task:t1')).toBe(0x744aa8ab)
    expect(hash32('')).toBe(0x811c9dc5)
  })

  it('is an unsigned 32-bit integer', () => {
    for (const s of ['a', 'task:🏠', 'C182 Tower', 'x'.repeat(500)]) {
      const h = hash32(s)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('rngFor', () => {
  it('is the generator of the hashed seed and id', () => {
    expect(rngFor(1337, 'task:t1')()).toBe(mulberry32(hash32('1337:task:t1'))())
  })

  it('gives every id its own stream, whatever else was drawn before', () => {
    const first = rngFor(5, 'task:a')()
    rngFor(5, 'task:b')()
    expect(rngFor(5, 'task:a')()).toBe(first)
    expect(rngFor(5, 'task:b')()).not.toBe(first)
    expect(rngFor(6, 'task:a')()).not.toBe(first)
  })
})
