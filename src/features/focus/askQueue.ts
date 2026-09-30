/**
 * The line of "Done with this task?" questions waiting in one tab. The first one is on screen; a newer
 * one waits its turn instead of replacing it, so no question is lost when several sessions end before
 * the first is answered (a phase that auto-started, or a second tab that settled one). Pure: each
 * function returns the same array when nothing changes, so callers can tell.
 */
import type { ID } from '@/db/types'

/** Adds a question at the back, unless it is already in line. */
export function ask(queue: readonly ID[], id: ID): readonly ID[] {
  return queue.includes(id) ? queue : [...queue, id]
}

/** The question on screen was answered or dismissed: the next one comes up. Anything else changes nothing. */
export function answered(queue: readonly ID[], id: ID): readonly ID[] {
  return queue[0] === id ? queue.slice(1) : queue
}

/** Takes a question out of line wherever it stands (its session's finish was taken back). */
export function withdraw(queue: readonly ID[], id: ID): readonly ID[] {
  return queue.includes(id) ? queue.filter((queued) => queued !== id) : queue
}
