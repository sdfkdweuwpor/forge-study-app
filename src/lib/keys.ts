/**
 * Keyboard shortcut specs: 'mod+k', 'q', 'g t' (sequence), 'shift+s', '?', 'mod+\\', 'alt+up', 'esc'.
 * `mod` is ⌘ on macOS and Ctrl elsewhere. Pure functions; the platform is passed in so tests can cover both.
 */

export interface Chord {
  /** Normalised lower-case `KeyboardEvent.key`: 'k', '?', 'escape', 'arrowup', ' ', 'enter'… */
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
}

/** The subset of KeyboardEvent we read (lets tests pass plain objects). */
export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

const ALIASES: Record<string, string> = {
  esc: 'escape',
  space: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
  return: 'enter',
  plus: '+',
}

export function parseChord(spec: string): Chord {
  const chord: Chord = { key: '', mod: false, shift: false, alt: false }
  const parts =
    spec.length > 1 && spec.endsWith('++')
      ? [...spec.slice(0, -2).split('+'), '+']
      : spec.split('+')
  for (const raw of parts) {
    const part = raw.toLowerCase()
    if (part === 'mod') chord.mod = true
    else if (part === 'shift') chord.shift = true
    else if (part === 'alt' || part === 'option') chord.alt = true
    else chord.key = ALIASES[part] ?? part
  }
  return chord
}

/** 'g t' → [g, t]. A plain single chord returns one element. */
export function parseKeys(spec: string): Chord[] {
  return spec.trim().split(/\s+/).filter(Boolean).map(parseChord)
}

/** Canonical string used to detect duplicate bindings: 'mod+k', 'g t', 'shift+s'. */
export function normalizeKeys(spec: string): string {
  return parseKeys(spec)
    .map((c) =>
      [c.mod ? 'mod' : '', c.alt ? 'alt' : '', c.shift ? 'shift' : '', c.key]
        .filter(Boolean)
        .join('+'),
    )
    .join(' ')
}

export function matchChord(chord: Chord, e: KeyLike, mac: boolean): boolean {
  const modDown = mac ? e.metaKey : e.ctrlKey
  const otherModDown = mac ? e.ctrlKey : e.metaKey
  if (chord.mod !== modDown || otherModDown || chord.alt !== e.altKey) return false
  const key = e.key.toLowerCase()
  if (key !== chord.key) return false
  // Shift is significant for letters and named keys. Symbols like '?' or '#' already encode it in `key`.
  const isSymbol = chord.key.length === 1 && !/[a-z0-9]/.test(chord.key)
  return isSymbol ? true : chord.shift === e.shiftKey
}

const MAC_SYMBOLS: Record<string, string> = { mod: '⌘', alt: '⌥', shift: '⇧' }
const KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  enter: '↵',
  ' ': 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  backspace: '⌫',
  delete: 'Del',
}

/** Display parts for a <Kbd>: 'mod+k' → ['⌘','K'] on Mac, ['Ctrl','K'] elsewhere. Sequences flatten: 'g t' → ['G','T']. */
export function formatKeys(spec: string, mac: boolean): string[] {
  const out: string[] = []
  for (const c of parseKeys(spec)) {
    if (c.mod) out.push(mac ? MAC_SYMBOLS.mod! : 'Ctrl')
    if (c.alt) out.push(mac ? MAC_SYMBOLS.alt! : 'Alt')
    if (c.shift) out.push(mac ? MAC_SYMBOLS.shift! : 'Shift')
    out.push(KEY_LABELS[c.key] ?? c.key.toUpperCase())
  }
  return out
}
