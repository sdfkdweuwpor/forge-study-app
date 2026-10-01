import { describe, expect, it } from 'vitest'
import { firstIndex, lastIndex, stepIndex, typeaheadIndex } from './menuNav'

describe('stepIndex', () => {
  const enabled = [true, false, true, true]

  it('moves down and skips disabled items', () => {
    expect(stepIndex(enabled, 0, 1)).toBe(2)
    expect(stepIndex(enabled, 2, 1)).toBe(3)
  })

  it('moves up and skips disabled items', () => {
    expect(stepIndex(enabled, 2, -1)).toBe(0)
  })

  it('wraps at both ends', () => {
    expect(stepIndex(enabled, 3, 1)).toBe(0)
    expect(stepIndex(enabled, 0, -1)).toBe(3)
  })

  it('starts at the first item going down and the last going up from nothing', () => {
    expect(stepIndex(enabled, -1, 1)).toBe(0)
    expect(stepIndex(enabled, -1, -1)).toBe(3)
    expect(stepIndex([false, true, true], -1, 1)).toBe(1)
  })

  it('returns -1 when nothing is enabled or the list is empty', () => {
    expect(stepIndex([false, false], 0, 1)).toBe(-1)
    expect(stepIndex([], -1, 1)).toBe(-1)
  })

  it('stays on the only enabled item', () => {
    expect(stepIndex([false, true, false], 1, 1)).toBe(1)
  })
})

describe('firstIndex / lastIndex', () => {
  it('find the first and last enabled items', () => {
    expect(firstIndex([false, true, true, false])).toBe(1)
    expect(lastIndex([false, true, true, false])).toBe(2)
  })

  it('return -1 when nothing is enabled', () => {
    expect(firstIndex([false])).toBe(-1)
    expect(lastIndex([])).toBe(-1)
  })
})

describe('typeaheadIndex', () => {
  const labels = ['New task', 'New goal', 'Focus now', 'Go to Today', 'Delete']
  const enabled = labels.map(() => true)

  it('finds the first label starting with one character, after the current item', () => {
    expect(typeaheadIndex(labels, enabled, -1, 'n')).toBe(0)
    expect(typeaheadIndex(labels, enabled, 0, 'n')).toBe(1)
  })

  it('cycles and wraps on repeated presses of the same key', () => {
    expect(typeaheadIndex(labels, enabled, 1, 'n')).toBe(0)
    expect(typeaheadIndex(labels, enabled, 0, 'nn')).toBe(1)
  })

  it('matches a longer buffer, starting at the current item', () => {
    expect(typeaheadIndex(labels, enabled, 1, 'new g')).toBe(1)
    expect(typeaheadIndex(labels, enabled, 0, 'go')).toBe(3)
  })

  it('is case-insensitive', () => {
    expect(typeaheadIndex(labels, enabled, -1, 'DEL')).toBe(4)
  })

  it('skips disabled items', () => {
    expect(typeaheadIndex(labels, [true, false, true, true, true], -1, 'new')).toBe(0)
    expect(typeaheadIndex(labels, [false, false, true, true, true], -1, 'new')).toBe(-1)
  })

  it('returns -1 for no match or an empty buffer', () => {
    expect(typeaheadIndex(labels, enabled, -1, 'z')).toBe(-1)
    expect(typeaheadIndex(labels, enabled, -1, '')).toBe(-1)
    expect(typeaheadIndex([], [], -1, 'a')).toBe(-1)
  })
})
