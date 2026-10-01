/**
 * Whole-app failures that happen outside React (boot, database events). The root component subscribes
 * and swaps the app for an error screen; nothing here depends on React or app context.
 */

export type FatalState =
  /** Startup threw, for example the database could not be opened. */
  | { kind: 'boot-failed'; error: Error }
  /** Startup is still waiting (usually an IndexedDB open blocked by another tab). Cleared if it finishes. */
  | { kind: 'boot-timeout' }
  /** Another tab upgraded or deleted the database; this tab's connection was closed. */
  | { kind: 'db-stale' }

let current: FatalState | null = null
const listeners = new Set<() => void>()

export function getFatal(): FatalState | null {
  return current
}

export function subscribeFatal(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A stale database connection outranks everything else: the tab cannot work until it reloads. */
export function setFatal(next: FatalState): void {
  if (current?.kind === 'db-stale' && next.kind !== 'db-stale') return
  current = next
  listeners.forEach((l) => l())
}

/** Clears the state, but only if it is still `kind` (a late boot must not hide a newer failure). */
export function clearFatal(kind: FatalState['kind']): void {
  if (current?.kind !== kind) return
  current = null
  listeners.forEach((l) => l())
}

/** Test helper. */
export function resetFatal(): void {
  current = null
  listeners.clear()
}
