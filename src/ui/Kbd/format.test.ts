import { describe, expect, it } from 'vitest'
import { ariaKeyShortcuts, formatShortcut, spokenShortcut } from './format'

describe('formatShortcut', () => {
  it('maps mod to ⌘ on macOS and Ctrl elsewhere', () => {
    expect(formatShortcut('mod+k', true)).toEqual([['⌘', 'K']])
    expect(formatShortcut('mod+k', false)).toEqual([['Ctrl', 'K']])
  })

  it('orders Mac modifiers the Apple way (⌥ ⇧ ⌘) and others Ctrl, Alt, Shift', () => {
    expect(formatShortcut('mod+shift+s', true)).toEqual([['⇧', '⌘', 'S']])
    expect(formatShortcut('shift+mod+s', false)).toEqual([['Ctrl', 'Shift', 'S']])
    expect(formatShortcut('alt+up', true)).toEqual([['⌥', '↑']])
    expect(formatShortcut('alt+up', false)).toEqual([['Alt', '↑']])
  })

  it('splits sequences into one group per chord', () => {
    expect(formatShortcut('g t', true)).toEqual([['G'], ['T']])
    expect(formatShortcut('  v   b ', false)).toEqual([['V'], ['B']])
  })

  it('names special keys per platform and keeps symbols', () => {
    expect(formatShortcut('esc', true)).toEqual([['Esc']])
    expect(formatShortcut('mod+enter', true)).toEqual([['⌘', '↩']])
    expect(formatShortcut('mod+enter', false)).toEqual([['Ctrl', 'Enter']])
    expect(formatShortcut('mod+backspace', false)).toEqual([['Ctrl', 'Backspace']])
    expect(formatShortcut('mod+\\', true)).toEqual([['⌘', '\\']])
    expect(formatShortcut('?', false)).toEqual([['?']])
    expect(formatShortcut('space', false)).toEqual([['Space']])
  })
})

describe('spokenShortcut', () => {
  it('reads modifiers as words and sequences with "then"', () => {
    expect(spokenShortcut('mod+k', true)).toBe('Command K')
    expect(spokenShortcut('mod+k', false)).toBe('Control K')
    expect(spokenShortcut('g t', true)).toBe('G then T')
    expect(spokenShortcut('?', true)).toBe('Question mark')
  })
})

describe('ariaKeyShortcuts', () => {
  it('uses UI Events names for single chords', () => {
    expect(ariaKeyShortcuts('mod+k', true)).toBe('Meta+K')
    expect(ariaKeyShortcuts('mod+k', false)).toBe('Control+K')
    expect(ariaKeyShortcuts('shift+s', false)).toBe('Shift+S')
    expect(ariaKeyShortcuts('esc', false)).toBe('Escape')
  })

  it('returns undefined for sequences, which aria-keyshortcuts cannot express', () => {
    expect(ariaKeyShortcuts('g t', true)).toBeUndefined()
    expect(ariaKeyShortcuts('', true)).toBeUndefined()
  })
})
