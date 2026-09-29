/**
 * Pending notes edits, by task. `NotesField` saves after a pause; anything that is about to read or
 * move the task (trashing it, say) calls `flushNotes` first so the words just typed are not left
 * behind in a debounce timer.
 */
import type { ID } from '@/db/types'

const flushers = new Map<ID, Set<() => Promise<void>>>()

/** A mounted notes field registers how to save what it holds. Returns the unregister function. */
export function registerNotesFlush(taskId: ID, flush: () => Promise<void>): () => void {
  const set = flushers.get(taskId) ?? new Set()
  set.add(flush)
  flushers.set(taskId, set)
  return () => {
    set.delete(flush)
    if (set.size === 0 && flushers.get(taskId) === set) flushers.delete(taskId)
  }
}

/** Saves any unsaved notes of `taskId` now. Resolves when the write has landed (or failed and been reported). */
export async function flushNotes(taskId: ID): Promise<void> {
  const set = flushers.get(taskId)
  if (!set) return
  await Promise.all([...set].map((flush) => flush()))
}
