/**
 * Status for the Settings screen: the state `describeSync` needs, gathered from the places it lives. The
 * stored state and the outbox are live queries (every tab sees the same), the engine's own state comes
 * from the tab that syncs, and the clock ticks once a minute, which is as fine as the words are
 * ("12 minutes ago"). The sentences themselves are decided in `logic/syncStatus.ts`.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { useNow } from '@/app/hooks/useNow'
import { usePendingSyncCount, type SyncStateView } from '@/db/hooks/useSyncState'
import { describeSync, type SyncStatusLine } from '@/logic/syncStatus'
import { getEngineState, subscribeEngineState, type EngineState } from './engineState'

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** `navigator.onLine`: only a hint, which is all the status line needs. */
function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  )
}

/** What the engine of this page (or the tab that syncs) says; idle before there is one. */
export function useEngineState(): EngineState {
  return useSyncExternalStore(subscribeEngineState, getEngineState, getEngineState)
}

export interface SyncStatus {
  line: SyncStatusLine
  engine: EngineState
  pending: number
}

export function useSyncStatus(view: SyncStateView): SyncStatus {
  const pending = usePendingSyncCount() ?? 0
  const engine = useEngineState()
  const online = useOnline()
  const now = useNow('minute')
  const { signedIn, lastSyncAt, lastError } = view
  const line = useMemo(
    () =>
      describeSync({
        now,
        online,
        running: engine.running,
        pending,
        signedIn,
        lastSyncAt,
        lastError,
        retryAt: engine.retryAt,
        paused: engine.paused,
      }),
    [
      now,
      online,
      engine.running,
      engine.retryAt,
      engine.paused,
      pending,
      signedIn,
      lastSyncAt,
      lastError,
    ],
  )
  return { line, engine, pending }
}
