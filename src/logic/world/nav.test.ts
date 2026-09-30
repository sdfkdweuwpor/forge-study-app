import { describe, expect, it } from 'vitest'
import { newestItem, stepItem } from './nav'
import type { Placed } from './types'

const p = (id: string, earnedAt: number): Placed => ({
  id,
  kind: 'house',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  floors: 0,
  variant: 0,
  label: null,
  earnedFrom: null,
  earnedAt,
})

const list = [p('a', 30), p('b', 10), p('c', 20)] // draw order a, b, c

describe('newestItem', () => {
  it('is the one earned last', () => {
    expect(newestItem(list)?.id).toBe('a')
    expect(newestItem([])).toBeNull()
  })
})

describe('stepItem', () => {
  it('starts at the newest item', () => {
    expect(stepItem(list, null, 1)?.id).toBe('a')
    expect(stepItem(list, 'gone', 1)?.id).toBe('a')
  })

  it('moves along the draw order and stops at the ends', () => {
    expect(stepItem(list, 'a', 1)?.id).toBe('b')
    expect(stepItem(list, 'b', 1)?.id).toBe('c')
    expect(stepItem(list, 'c', 1)?.id).toBe('c')
    expect(stepItem(list, 'c', -1)?.id).toBe('b')
    expect(stepItem(list, 'a', -1)?.id).toBe('a')
  })

  it('has nothing to step to in an empty world', () => {
    expect(stepItem([], null, 1)).toBeNull()
  })
})
