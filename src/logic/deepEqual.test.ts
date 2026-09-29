import { describe, expect, it } from 'vitest'
import { deepEqual } from './deepEqual'

describe('deepEqual', () => {
  it('compares primitives, including NaN and signed zero', () => {
    expect(deepEqual(1, 1)).toBe(true)
    expect(deepEqual('C182', 'C182')).toBe(true)
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(true)
    expect(deepEqual(0, -0)).toBe(false)
    expect(deepEqual(1, '1')).toBe(false)
    expect(deepEqual(null, undefined)).toBe(false)
    expect(deepEqual(null, null)).toBe(true)
  })

  it('compares nested objects regardless of key order', () => {
    expect(deepEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true)
    expect(deepEqual({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [2, 1] } })).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(deepEqual({ a: undefined }, { b: undefined })).toBe(false)
  })

  it('tells arrays from objects and respects length', () => {
    expect(deepEqual([], {})).toBe(false)
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
    expect(deepEqual([], [])).toBe(true)
    expect(deepEqual({ 0: 'a' }, ['a'])).toBe(false)
  })
})
