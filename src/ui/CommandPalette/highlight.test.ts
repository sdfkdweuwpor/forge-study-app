import { describe, expect, it } from 'vitest'
import { highlightSegments } from './highlight'

describe('highlightSegments', () => {
  it('returns one plain run without matches', () => {
    expect(highlightSegments('Start focus', undefined)).toEqual([
      { text: 'Start focus', hit: false },
    ])
    expect(highlightSegments('Start focus', [])).toEqual([{ text: 'Start focus', hit: false }])
  })

  it('returns nothing for empty text', () => {
    expect(highlightSegments('', [0, 1])).toEqual([])
  })

  it('groups adjacent matched characters into one run', () => {
    expect(highlightSegments('C182 Intro to IT', [0, 1, 2, 3])).toEqual([
      { text: 'C182', hit: true },
      { text: ' Intro to IT', hit: false },
    ])
  })

  it('handles scattered fuzzy matches in any order and duplicates', () => {
    expect(highlightSegments('New task', [4, 0, 4, 6])).toEqual([
      { text: 'N', hit: true },
      { text: 'ew ', hit: false },
      { text: 't', hit: true },
      { text: 'a', hit: false },
      { text: 's', hit: true },
      { text: 'k', hit: false },
    ])
  })

  it('ignores out-of-range and non-integer indices', () => {
    expect(highlightSegments('Goals', [-1, 1.5, 99, 0])).toEqual([
      { text: 'G', hit: true },
      { text: 'oals', hit: false },
    ])
  })

  it('never splits a surrogate pair', () => {
    expect(highlightSegments('🎯 Goals', [1])).toEqual([
      { text: '🎯', hit: true },
      { text: ' Goals', hit: false },
    ])
    expect(highlightSegments('🎯 Goals', [0])).toEqual([
      { text: '🎯', hit: true },
      { text: ' Goals', hit: false },
    ])
  })

  it('reassembles to the original text', () => {
    const text = 'D278 Scripting and Programming'
    const joined = highlightSegments(text, [0, 5, 6, 20]).map((s) => s.text).join('')
    expect(joined).toBe(text)
  })
})
