import { describe, expect, it } from 'vitest'
import type { TagColor } from '@/db/types'
import { cleanTags, hashTag, normalizeTag, TAG_COLORS, tagColor } from '@/logic/tagColor'

describe('tagColor', () => {
  it('has the nine palette names', () => {
    expect([...TAG_COLORS]).toEqual([
      'gray',
      'brown',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'pink',
      'red',
    ])
  })

  it('is stable: pinned values must never change (colours are not stored)', () => {
    const pinned: Array<[string, TagColor]> = [
      ['C182', 'pink'],
      ['C183', 'blue'],
      ['C779', 'pink'],
      ['D278', 'green'],
      ['exam', 'yellow'],
      ['urgent', 'purple'],
    ]
    for (const [tag, color] of pinned) expect(tagColor(tag)).toBe(color)
    expect(hashTag('C182')).toBe(2155810921)
  })

  it('always returns one of the nine colours and the same one each time', () => {
    for (const tag of ['a', 'exam', 'C182', 'wgu/d278', 'révision', '😀', '', ' ', '#']) {
      const color = tagColor(tag)
      expect(TAG_COLORS).toContain(color)
      expect(tagColor(tag)).toBe(color)
    }
  })

  it('ignores case, surrounding space and a leading #', () => {
    expect(tagColor('c182')).toBe(tagColor('C182'))
    expect(tagColor('#C182')).toBe(tagColor('C182'))
    expect(tagColor('  C182 ')).toBe(tagColor('C182'))
    expect(normalizeTag(' ##Exam ')).toBe('exam')
  })

  it('spreads course codes over all nine colours', () => {
    const counts = new Map<TagColor, number>()
    let total = 0
    for (const prefix of ['C', 'D']) {
      for (let n = 100; n < 600; n++) {
        const color = tagColor(`${prefix}${n}`)
        counts.set(color, (counts.get(color) ?? 0) + 1)
        total++
      }
    }
    expect(counts.size).toBe(9)
    for (const color of TAG_COLORS) {
      const share = (counts.get(color) ?? 0) / total
      expect(share).toBeGreaterThan(0.06) // ideal: 0.111
      expect(share).toBeLessThan(0.17)
    }
  })

  it('does not put consecutive course codes in a visible pattern', () => {
    let sameAsPrevious = 0
    let previous = tagColor('C100')
    for (let n = 101; n < 300; n++) {
      const color = tagColor(`C${n}`)
      if (color === previous) sameAsPrevious++
      previous = color
    }
    expect(sameAsPrevious).toBeLessThan(40) // ~22 expected by chance
  })

  describe('overrides', () => {
    it('wins over the hash, by exact key', () => {
      const natural = tagColor('C182')
      const other: TagColor = natural === 'red' ? 'blue' : 'red'
      expect(tagColor('C182', { C182: other })).toBe(other)
    })

    it('matches case-insensitively and ignores a leading #', () => {
      expect(tagColor('exam', { Exam: 'orange' })).toBe('orange')
      expect(tagColor('#exam', { exam: 'orange' })).toBe('orange')
      expect(tagColor('EXAM', { '#exam': 'orange' })).toBe('orange')
    })

    it('leaves other tags on their hashed colour', () => {
      expect(tagColor('C779', { C182: 'red' })).toBe(tagColor('C779'))
    })

    it('ignores overrides holding an unknown colour', () => {
      const bad = { exam: 'magenta' } as unknown as Record<string, TagColor>
      expect(tagColor('exam', bad)).toBe(tagColor('exam'))
    })

    it('is safe against prototype keys', () => {
      expect(TAG_COLORS).toContain(tagColor('constructor', {}))
      expect(TAG_COLORS).toContain(tagColor('__proto__', {}))
      expect(tagColor('toString', {})).toBe(tagColor('toString'))
    })

    it('treats undefined and empty overrides as none', () => {
      expect(tagColor('exam', undefined)).toBe(tagColor('exam'))
      expect(tagColor('exam', {})).toBe(tagColor('exam'))
    })
  })
})

describe('cleanTags', () => {
  it('trims, strips leading #, drops empties and case-insensitive duplicates, keeps first spelling', () => {
    expect(cleanTags(['#C182', ' c182 ', '', '##', 'mentor', 'Mentor', ' # errands'])).toEqual([
      'C182',
      'mentor',
      'errands',
    ])
  })

  it('returns a new array and copes with no tags', () => {
    const input = ['a']
    expect(cleanTags(input)).not.toBe(input)
    expect(cleanTags([])).toEqual([])
  })
})
