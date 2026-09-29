import { createContext, useContext, useSyncExternalStore } from 'react'
import type { SessionMode } from '@/db/types'
import { subscribePrefs } from '@/lib/localPrefs'
import { getMode } from './actions'
import { TimerStore, type TimerSnapshot } from './timerStore'

export const TimerContext = createContext<TimerStore | null>(null)

export function useTimerStore(): TimerStore {
  const store = useContext(TimerContext)
  if (!store) throw new Error('useTimer must be used inside <TimerProvider>')
  return store
}

/**
 * The ticking view of the running session: status, the whole seconds on screen and the ring fill. It
 * changes once per displayed second (not on every 250 ms heartbeat), and when the session or the picked
 * task changes. Write through `@/features/focus/actions`, never through this.
 */
export function useTimer(): TimerSnapshot {
  const store = useTimerStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/** The mode picked on the Focus page (a device preference), live across tabs. */
export function useMode(): SessionMode {
  return useSyncExternalStore(subscribePrefs, getMode, () => 'pomodoro')
}
