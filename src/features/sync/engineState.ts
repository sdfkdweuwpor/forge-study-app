/**
 * What the engine tells the screen, as a tiny external store (React reads it with `useSyncExternalStore`).
 * It lives apart from the engine so that reading it loads nothing: before an engine exists, and in a tab
 * that is not the one syncing until the leader's message arrives, it holds the idle state.
 */
import type { EngineShare } from './leader'

export interface EngineState extends EngineShare {
  /** This tab runs the sync (it holds the lock). */
  leader: boolean
}

export const IDLE_ENGINE: EngineState = {
  leader: false,
  running: false,
  retryAt: null,
  paused: false,
  progress: null,
}

let state: EngineState = IDLE_ENGINE
const listeners = new Set<() => void>()

const same = (a: EngineState, b: EngineState): boolean =>
  a.leader === b.leader &&
  a.running === b.running &&
  a.retryAt === b.retryAt &&
  a.paused === b.paused &&
  a.progress?.step === b.progress?.step &&
  a.progress?.rows === b.progress?.rows

export const getEngineState = (): EngineState => state

/** Replaces the state and tells the listeners, unless nothing changed (a snapshot must stay stable). */
export function setEngineState(next: EngineState): void {
  if (same(state, next)) return
  state = next
  for (const listener of [...listeners]) listener()
}

export function subscribeEngineState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
