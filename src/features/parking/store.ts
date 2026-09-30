/**
 * Two tiny signals shared between the palette commands, the shortcuts and the components that answer
 * them. They live outside React so a command can ask without knowing who is listening.
 *
 * - The popover: open or closed (`openParking`, `closeParking`, `useParkingOpen`).
 * - The review request ("Review parked thoughts"): the Today card scrolls itself into view and takes
 *   focus. A request that nobody answers within `REVIEW_WINDOW_MS` (the page never showed the card) is
 *   forgotten, so it cannot fire at some later visit.
 */
import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
const notify = (): void => {
  for (const listener of [...listeners]) listener()
}
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// ── The popover ─────────────────────────────────────────────────────────────────────────────────
let popoverOpen = false

export function openParking(): void {
  if (popoverOpen) return
  popoverOpen = true
  notify()
}

export function closeParking(): void {
  if (!popoverOpen) return
  popoverOpen = false
  notify()
}

export function useParkingOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => popoverOpen,
    () => false,
  )
}

// ── The review request ──────────────────────────────────────────────────────────────────────────
export const REVIEW_WINDOW_MS = 5000
let reviewAskedAt: number | null = null

/** Asks the Today card to show itself. Call it after navigating there. */
export function requestParkedReview(now: number = Date.now()): void {
  reviewAskedAt = now
  notify()
}

/** Whether a request is waiting; taking it clears it. */
export function takeParkedReview(now: number = Date.now()): boolean {
  const asked = reviewAskedAt
  reviewAskedAt = null
  return asked !== null && now - asked <= REVIEW_WINDOW_MS
}

/** Calls `listener` whenever a review is requested. Returns the unsubscribe function. */
export function onParkedReview(listener: () => void): () => void {
  return subscribe(listener)
}
