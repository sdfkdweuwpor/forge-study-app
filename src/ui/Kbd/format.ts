import { parseChord, type Chord } from '@/lib/keys'

/**
 * Display helpers for shortcut specs ('mod+k', 'shift+s', 'g t', '?', 'esc', 'alt+up').
 * `mod` is ⌘ on macOS and Ctrl elsewhere (PLAN §5.2). Pure: the platform is passed in.
 *
 * macOS lists modifiers in Apple's order (⌃ ⌥ ⇧ ⌘, so ⇧⌘S); other platforms use Ctrl, Alt, Shift.
 */

const MAC_KEYS: Record<string, string> = {
  escape: 'Esc',
  enter: '↩',
  ' ': 'Space',
  tab: '⇥',
  backspace: '⌫',
  delete: '⌦',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
}

const OTHER_KEYS: Record<string, string> = {
  escape: 'Esc',
  enter: 'Enter',
  ' ': 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Del',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
}

/** Names screen readers can say (⌘ is otherwise read as "place of interest sign"). */
const SPOKEN_KEYS: Record<string, string> = {
  escape: 'Escape',
  enter: 'Enter',
  ' ': 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: 'Up arrow',
  arrowdown: 'Down arrow',
  arrowleft: 'Left arrow',
  arrowright: 'Right arrow',
  '?': 'Question mark',
  '/': 'Slash',
  '\\': 'Backslash',
  '#': 'Hash',
}

/** `aria-keyshortcuts` key names (UI Events `key` values). */
const ARIA_KEYS: Record<string, string> = {
  escape: 'Escape',
  enter: 'Enter',
  ' ': 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
}

function chords(spec: string): Chord[] {
  return spec.trim().split(/\s+/).filter(Boolean).map(parseChord)
}

function keyLabel(key: string, table: Record<string, string>): string {
  return table[key] ?? key.toUpperCase()
}

/** Keycaps per chord: 'mod+k' → [['⌘','K']] on a Mac, [['Ctrl','K']] elsewhere; 'g t' → [['G'],['T']]. */
export function formatShortcut(spec: string, mac: boolean): string[][] {
  return chords(spec).map((c) => {
    const caps: string[] = []
    if (mac) {
      if (c.alt) caps.push('⌥')
      if (c.shift) caps.push('⇧')
      if (c.mod) caps.push('⌘')
    } else {
      if (c.mod) caps.push('Ctrl')
      if (c.alt) caps.push('Alt')
      if (c.shift) caps.push('Shift')
    }
    caps.push(keyLabel(c.key, mac ? MAC_KEYS : OTHER_KEYS))
    return caps
  })
}

/** Plain text for screen readers and titles: 'Command K', 'Control Shift S', 'G then T'. */
export function spokenShortcut(spec: string, mac: boolean): string {
  return chords(spec)
    .map((c) => {
      const words: string[] = []
      if (c.mod) words.push(mac ? 'Command' : 'Control')
      if (c.alt) words.push(mac ? 'Option' : 'Alt')
      if (c.shift) words.push('Shift')
      words.push(keyLabel(c.key, SPOKEN_KEYS))
      return words.join(' ')
    })
    .join(' then ')
}

/**
 * Value for `aria-keyshortcuts`: 'Meta+K' on a Mac, 'Control+K' elsewhere. Sequences such as
 * 'g t' cannot be expressed there (a space separates alternatives), so they return undefined.
 */
export function ariaKeyShortcuts(spec: string, mac: boolean): string | undefined {
  const list = chords(spec)
  const [c] = list
  if (list.length !== 1 || !c || !c.key) return undefined
  const parts: string[] = []
  if (c.mod) parts.push(mac ? 'Meta' : 'Control')
  if (c.alt) parts.push('Alt')
  if (c.shift) parts.push('Shift')
  parts.push(keyLabel(c.key, ARIA_KEYS))
  return parts.join('+')
}
