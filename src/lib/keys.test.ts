import { describe, expect, it } from 'vitest'
import {
  eventKey,
  formatKeys,
  keyFromCode,
  matchChord,
  normalizeKeys,
  parseChord,
  parseKeys,
  type KeyLike,
} from './keys'

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

describe('keyFromCode', () => {
  it('maps letters, digits and the punctuation keys', () => {
    expect(keyFromCode('KeyA')).toBe('a')
    expect(keyFromCode('KeyZ')).toBe('z')
    expect(keyFromCode('Digit1')).toBe('1')
    expect(keyFromCode('Backslash')).toBe('\\')
    expect(keyFromCode('Slash')).toBe('/')
  })

  it('has nothing for named keys or missing codes', () => {
    expect(keyFromCode('ArrowUp')).toBeNull()
    expect(keyFromCode('Enter')).toBeNull()
    expect(keyFromCode('')).toBeNull()
    expect(keyFromCode(undefined)).toBeNull()
  })
})

describe('eventKey / matchChord with layouts and Alt', () => {
  it('trusts `key` on ASCII layouts, even when `code` says otherwise (AZERTY, Dvorak)', () => {
    expect(eventKey({ ...ev('a'), code: 'KeyQ' })).toBe('a')
    expect(matchChord(parseChord('a'), { ...ev('a'), code: 'KeyQ' }, false)).toBe(true)
    expect(matchChord(parseChord('q'), { ...ev('a'), code: 'KeyQ' }, false)).toBe(false)
  })

  it('falls back to the physical key on non-Latin layouts', () => {
    // Russian layout: the K key types 'л', the G key 'п', the backslash key '\\' or 'ё' on some boards.
    expect(matchChord(parseChord('k'), { ...ev('л'), code: 'KeyK' }, false)).toBe(true)
    expect(matchChord(parseChord('g'), { ...ev('п'), code: 'KeyG' }, false)).toBe(true)
    expect(
      matchChord(parseChord('mod+k'), { ...ev('л', { ctrlKey: true }), code: 'KeyK' }, false),
    ).toBe(true)
    expect(matchChord(parseChord('1'), { ...ev('١'), code: 'Digit1' }, false)).toBe(true)
    expect(
      matchChord(parseChord('mod+\\'), { ...ev('¥', { ctrlKey: true }), code: 'Backslash' }, false),
    ).toBe(true)
  })

  it('keeps the non-ASCII key when there is no usable code', () => {
    expect(eventKey(ev('л'))).toBe('л')
    expect(matchChord(parseChord('k'), ev('л'), false)).toBe(false)
  })

  it('uses the physical key while Alt is held (⌥K types "˚" on a Mac)', () => {
    const optionK = { ...ev('˚', { altKey: true }), code: 'KeyK' }
    expect(eventKey(optionK)).toBe('k')
    expect(matchChord(parseChord('alt+k'), optionK, true)).toBe(true)
    expect(matchChord(parseChord('k'), optionK, true)).toBe(false)
    const alt1 = { ...ev('¡', { altKey: true }), code: 'Digit1' }
    expect(matchChord(parseChord('alt+1'), alt1, true)).toBe(true)
  })

  it('leaves named keys alone under Alt', () => {
    expect(
      matchChord(
        parseChord('alt+up'),
        { ...ev('ArrowUp', { altKey: true }), code: 'ArrowUp' },
        false,
      ),
    ).toBe(true)
  })

  it('never matches, and never throws, when the event has no string key', () => {
    const broken = { ...ev('x'), key: undefined } as unknown as KeyLike
    expect(eventKey(broken)).toBeNull()
    expect(matchChord(parseChord('x'), broken, false)).toBe(false)
    const numeric = { ...ev('x'), key: 5 } as unknown as KeyLike
    expect(matchChord(parseChord('5'), numeric, false)).toBe(false)
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
