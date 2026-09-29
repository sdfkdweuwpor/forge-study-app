import { describe, expect, it } from 'vitest'
import { formatKeys, matchChord, normalizeKeys, parseChord, parseKeys, type KeyLike } from './keys'

const ev = (key: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
})

describe('parseChord / parseKeys', () => {
  it('parses modifiers, aliases and symbols', () => {
    expect(parseChord('mod+k')).toEqual({ key: 'k', mod: true, shift: false, alt: false })
    expect(parseChord('esc').key).toBe('escape')
    expect(parseChord('alt+up')).toMatchObject({ key: 'arrowup', alt: true })
    expect(parseChord('mod+\\')).toMatchObject({ key: '\\', mod: true })
    expect(parseChord('?').key).toBe('?')
  })

  it('splits sequences on whitespace', () => {
    expect(parseKeys('g t').map((c) => c.key)).toEqual(['g', 't'])
    expect(parseKeys('mod+enter')).toHaveLength(1)
  })

  it('normalises equivalent specs to one string', () => {
    expect(normalizeKeys('Mod+K')).toBe(normalizeKeys('mod+k'))
    expect(normalizeKeys('esc')).toBe('escape')
    expect(normalizeKeys('shift+alt+x')).toBe('alt+shift+x')
  })
})

describe('matchChord', () => {
  it('maps mod to Cmd on Mac and Ctrl elsewhere', () => {
    const chord = parseChord('mod+\\')
    expect(matchChord(chord, ev('\\', { metaKey: true }), true)).toBe(true)
    expect(matchChord(chord, ev('\\', { ctrlKey: true }), true)).toBe(false)
    expect(matchChord(chord, ev('\\', { ctrlKey: true }), false)).toBe(true)
    expect(matchChord(chord, ev('\\', { metaKey: true }), false)).toBe(false)
  })

  it('does not fire plain keys when a modifier is held', () => {
    expect(matchChord(parseChord('q'), ev('q'), false)).toBe(true)
    expect(matchChord(parseChord('q'), ev('q', { ctrlKey: true }), false)).toBe(false)
    expect(matchChord(parseChord('q'), ev('Q', { shiftKey: true }), false)).toBe(false)
  })

  it('requires shift for shift chords, but ignores it for symbols', () => {
    expect(matchChord(parseChord('shift+s'), ev('S', { shiftKey: true }), false)).toBe(true)
    expect(matchChord(parseChord('shift+s'), ev('s'), false)).toBe(false)
    expect(matchChord(parseChord('?'), ev('?', { shiftKey: true }), false)).toBe(true)
  })

  it('matches named keys', () => {
    expect(matchChord(parseChord('esc'), ev('Escape'), false)).toBe(true)
    expect(matchChord(parseChord('alt+up'), ev('ArrowUp', { altKey: true }), false)).toBe(true)
  })
})

describe('formatKeys', () => {
  it('uses symbols on Mac and words elsewhere', () => {
    expect(formatKeys('mod+k', true)).toEqual(['⌘', 'K'])
    expect(formatKeys('mod+k', false)).toEqual(['Ctrl', 'K'])
    expect(formatKeys('g t', false)).toEqual(['G', 'T'])
    expect(formatKeys('esc', true)).toEqual(['Esc'])
  })
})
