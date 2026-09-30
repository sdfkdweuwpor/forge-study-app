/**
 * Data calls to PostgREST (PLAN §4.7.1), thin over `logic/syncRequests` and `http`. The caller owns the
 * session and refreshes it (a 401 is `unauthorized`; see `needsRefresh`); these only send what they are
 * given. Every failure is a `SupabaseError`.
 */
import type { Millis } from '@/db/types'
import type { PushRow, ServerRow, SyncServer } from '@/logic/sync'
import {
  parsePullRows,
  parseServerTime,
  pullRequest,
  pushRequest,
  serverTimeRequest,
  type SessionAuth,
  type TransportConfig,
} from '@/logic/syncRequests'
import { badAnswer, type Send } from './http'

/**
 * Upsert rows into `forge_rows`. Safe to repeat: the same rows make the same request, and the server
 * takes an equal stamp from the same device, so a push whose answer was lost can simply be sent again.
 * `keepalive` is for the flush when the page is being hidden (the batch must fit in 60 KB).
 */
export async function pushRows(
  send: Send,
  config: TransportConfig,
  session: SessionAuth,
  rows: readonly PushRow[],
  opts: { keepalive?: boolean } = {},
): Promise<void> {
  if (rows.length === 0) return
  await send(pushRequest(config, session, rows, opts))
}

/** Rows with `seq` above `afterSeq`, in `seq` order, at most `limit`. */
export async function pullRows(
  send: Send,
  config: TransportConfig,
  session: SessionAuth,
  afterSeq: number,
  limit: number,
): Promise<ServerRow[]> {
  const rows = parsePullRows(await send(pullRequest(config, session, afterSeq, limit)))
  if (rows === null) throw badAnswer()
  return rows
}

/** The server's clock in ms. */
export async function fetchServerTime(
  send: Send,
  config: TransportConfig,
  session: SessionAuth,
): Promise<Millis> {
  const at = parseServerTime(await send(serverTimeRequest(config, session)))
  if (at === null) throw badAnswer()
  return at
}

/**
 * The `SyncServer` the sync engine talks to. `getSession` is read on every call, so a refreshed token is
 * used at once; it holds no state of its own. `keepalive` makes every push outlive the page, for the
 * flush when it is hidden (the engine keeps the batch under 60 KB).
 */
export function createSyncServer(
  send: Send,
  config: TransportConfig,
  getSession: () => SessionAuth,
  opts: { keepalive?: boolean } = {},
): SyncServer {
  return {
    push: (rows) => pushRows(send, config, getSession(), rows, opts),
    pull: (afterSeq, limit) => pullRows(send, config, getSession(), afterSeq, limit),
    serverTime: () => fetchServerTime(send, config, getSession()),
  }
}
