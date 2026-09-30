/**
 * Which ritual dialog is open. Palette commands, shortcuts, Today's prompt and the Settings buttons have
 * no React context in common, so they ask here and `RitualsHost` (slot `global.overlays`) shows it. The
 * host loads lazily; a request made before it exists simply waits in this module.
 *
 * At most one dialog is open. Each opening gets a new `session`, so its state starts fresh.
 */
import { useSyncExternalStore } from 'react'

export type RitualDialog = 'morning' | 'evening' | 'routine' | 'saveRoutine'

export interface OpenDialog {
  kind: RitualDialog
  /** Changes on every opening, so a dialog remounts with empty state. */
  session: number
  /** When it was opened: the day a ritual is for is fixed from this (`ritualDay`). */
  openedAt: number
}

const listeners = new Set<() => void>()
let current: OpenDialog | null = null
let session = 0

const notify = (): void => {
  for (const listener of [...listeners]) listener()
}
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Opens a dialog (replacing any other). */
export function openRitualDialog(kind: RitualDialog): void {
  session += 1
  current = { kind, session, openedAt: Date.now() }
  notify()
}

/** Forgets the open dialog. Called once its exit animation has finished. */
export function clearRitualDialog(fromSession: number): void {
  if (current?.session !== fromSession) return
  current = null
  notify()
}

export function useOpenRitualDialog(): OpenDialog | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
}
