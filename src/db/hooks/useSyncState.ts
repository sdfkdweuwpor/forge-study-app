import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { SYNC_STATE_ID } from '../sync/tracking'
import type { Millis, SyncError, SyncStateRow } from '../types'

/**
 * What the interface may know about this device's sync: everything in `syncState` except the tokens and
 * the PKCE verifier, which no screen has any business holding. Reach them through `@/db/repos/sync`
 * (`getSyncSession`) where the engine needs them.
 */
export interface SyncStateView {
  enabled: boolean
  phase: SyncStateRow['phase']
  url: string | null
  anonKey: string | null
  email: string | null
  /** There is a session: the person is signed in (an expired one is refreshed by the engine). */
  signedIn: boolean
  /** A sign-in link or code was requested and not used yet: the email it went to, and when. */
  pendingLogin: { email: string; requestedAt: Millis } | null
  lastSyncAt: Millis | null
  lastAttemptAt: Millis | null
  lastError: SyncError | null
  /** Server clock minus this device's, when measured. */
  clockSkewMs: number | null
}

function toView(row: SyncStateRow): SyncStateView {
  return {
    enabled: row.enabled,
    phase: row.phase,
    url: row.url,
    anonKey: row.anonKey,
    email: row.email,
    signedIn: row.session !== null,
    pendingLogin: row.pendingLogin
      ? { email: row.pendingLogin.email, requestedAt: row.pendingLogin.requestedAt }
      : null,
    lastSyncAt: row.lastSyncAt,
    lastAttemptAt: row.lastAttemptAt,
    lastError: row.lastError,
    clockSkewMs: row.clockSkewMs,
  }
}

/**
 * Live sync status: `undefined` while the first read is loading, `null` when sync was never set up (the
 * state of everyone who does not use it), otherwise the row without its secrets.
 */
export function useSyncState(): SyncStateView | null | undefined {
  return useLiveQuery(async () => {
    const row = await db.syncState.get(SYNC_STATE_ID)
    return row ? toView(row) : null
  }, [])
}

/**
 * Whether sync is on for this device (tracking and the engine). False while loading and when it was never
 * set up, so a dialog can say "Sync is on: …" without waiting.
 */
export function useSyncOn(): boolean {
  return (
    useLiveQuery(async () => (await db.syncState.get(SYNC_STATE_ID))?.enabled === true, []) ===
    true
  )
}

/** Changes waiting to be sent (the outbox), live; `undefined` while loading. */
export function usePendingSyncCount(): number | undefined {
  return useLiveQuery(() => db.syncOutbox.count(), [])
}
