import { createContext, useContext, useSyncExternalStore } from 'react'
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
