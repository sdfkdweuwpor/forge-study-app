/**
 * Undo/redo for the block editor. The browser's own undo cannot span blocks (splits, merges,
 * conversions), so the editor keeps snapshots of the whole document. Pure: time is passed in.
 *
 * Typing is grouped: consecutive edits with the same `key` (say, typing in one block) less than
 * `GROUP_MS` apart share one snapshot, so Undo removes a burst of typing, not a letter.
 */
import type { Block, ID } from '@/logic/blocks'

export interface Snapshot {
  doc: readonly Block[]
  /** Block that held the caret, and the caret offset there. */
  focusId: ID | null
  caret: number
}

export interface History {
  past: readonly Snapshot[]
  future: readonly Snapshot[]
  /** Key and time of the last recorded edit, for grouping. */
  lastKey: string | null
  lastAt: number
}

export const GROUP_MS = 1000
export const MAX_STEPS = 100

export const emptyHistory: History = { past: [], future: [], lastKey: null, lastAt: 0 }

/**
 * Records an edit. `before` is the state the edit starts from. With a `key`, an edit that follows
 * another with the same key within `GROUP_MS` joins its group; the earliest `before` is kept.
 */
export function record(h: History, before: Snapshot, key: string | null, now: number): History {
  const grouped =
    key !== null && key === h.lastKey && now - h.lastAt < GROUP_MS && h.past.length > 0
  const past = grouped ? h.past : [...h.past, before].slice(-MAX_STEPS)
  return { past, future: [], lastKey: key, lastAt: now }
}

export interface Step {
  history: History
  /** The state to show. */
  snapshot: Snapshot
}

/** Undo: returns the snapshot to restore, and the history with `current` pushed onto redo. */
export function undo(h: History, current: Snapshot): Step | null {
  const snapshot = h.past[h.past.length - 1]
  if (!snapshot) return null
  return {
    snapshot,
    history: {
      past: h.past.slice(0, -1),
      future: [...h.future, current],
      lastKey: null,
      lastAt: 0,
    },
  }
}

/** Redo: the reverse of `undo`. */
export function redo(h: History, current: Snapshot): Step | null {
  const snapshot = h.future[h.future.length - 1]
  if (!snapshot) return null
  return {
    snapshot,
    history: {
      past: [...h.past, current].slice(-MAX_STEPS),
      future: h.future.slice(0, -1),
      lastKey: null,
      lastAt: 0,
    },
  }
}

/** Length of the common prefix of two strings. */
export function commonPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

/**
 * Where the caret belongs after restoring `snapshot` over `current`: at the first place a block's
 * text differs (where the undone edit happened), else where the snapshot says it was.
 */
export function caretAfterRestore(
  snapshot: Snapshot,
  current: readonly Block[],
): { focusId: ID | null; caret: number } {
  const now = new Map(current.map((b) => [b.id, b.text]))
  for (const block of snapshot.doc) {
    const other = now.get(block.id)
    if (other !== undefined && other !== block.text) {
      return { focusId: block.id, caret: commonPrefix(block.text, other) }
    }
  }
  return { focusId: snapshot.focusId, caret: snapshot.caret }
}
