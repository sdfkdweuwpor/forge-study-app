import { describe, expect, it } from 'vitest'
import { nextIndex } from './roving'

describe('nextIndex', () => {
  const none = [false, false, false, false]

  it('moves with arrows and wraps', () => {
    expect(nextIndex('ArrowRight', 0, none)).toBe(1)
    expect(nextIndex('ArrowRight', 3, none)).toBe(0)
    expect(nextIndex('ArrowLeft', 0, none)).toBe(3)
    expect(nextIndex('ArrowDown', 1, none)).toBe(2)
  })

  it('skips disabled items and handles Home/End', () => {
    const d = [true, false, true, false]
    expect(nextIndex('ArrowRight', 1, d)).toBe(3)
    expect(nextIndex('ArrowRight', 3, d)).toBe(1)
    expect(nextIndex('Home', 3, d)).toBe(1)
    expect(nextIndex('End', 1, d)).toBe(3)
  })

  it('ignores vertical arrows for horizontal-only widgets and other keys', () => {
    expect(nextIndex('ArrowDown', 0, none, 'horizontal')).toBeNull()
    expect(nextIndex('a', 0, none)).toBeNull()
    expect(nextIndex('ArrowRight', 0, [true, true])).toBeNull()
  })
})
