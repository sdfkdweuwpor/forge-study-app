/**
 * Cloud sync rules (pure; PLAN §4.7.4–§4.7.6). Everything the engine (`db/repos/sync.ts`), the transport
 * (`features/sync/supabase`) and the fake server (`logic/syncServerModel.ts`) need to *decide*, without
 * doing anything: no clock (time is a parameter), no randomness (so is the jitter), no fetch, no
 * database.
 *
 *  - stamps: the hybrid write stamp, the total order `newer`, the server's clamp;
 *  - errors: what a failure means (`classifySyncError`), and when to try again (`planRetry`);
 *  - merging: `decideApply` for one pulled row, settings without device-only fields, first-sync
 *    rules (seed duplicates, what a device queues), the `xpEvents` union;
 *  - pushing: `toServerRow`, batching by bytes, the outbox helpers;
 *  - pulling: cursor and page state, newer-schema detection, the safety-snapshot predicate, row migration.
 *
 * Which tables sync and which settings fields stay on the device live in `syncTables.ts`.
 */
import type { Millis, SyncErrorKind, SyncOutboxEntry } from '@/db/types'
import { migrateRowsV1toV2, trashToV2 } from './schemaV2'
import { settingsToV3 } from './schemaV3'
import { markTrashBlobs } from './snapshotJson'
import {
  isSyncTable,
  nextStamp,
  SETTINGS_DEVICE_PATHS,
  syncedSettings,
  type SyncTableName,
} from './syncTables'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

// ─── Shared types ───────────────────────────────────────────────────────────

/** A last-write-wins stamp: when the write was made (ms) and by which device (the tie-break). */
export interface Stamp {
  at: Millis
  device: string
}

/** One record as it travels to the server (`forge_rows` without `user_id`, which the session supplies). */
export interface PushRow {
  tbl: SyncTableName
  id: string
  /** The write stamp (`Stamp.at`), not the row's own `updatedAt`. */
  updatedAt: Millis
  deviceId: string
  deleted: boolean
  schemaVersion: number
  /** The Forge row as JSON; `null` for a tombstone. */
  data: unknown
}

/** A record as the server returns it, with its change-cursor position. */
export interface ServerRow extends PushRow {
  seq: number
}

/** What the engine talks to: the Supabase transport in the app, `syncServerModel` in tests. */
export interface SyncServer {
  /** Upsert rows. Throws `SyncTransportError`. */
  push(rows: readonly PushRow[]): Promise<void>
  /** Rows with `seq > afterSeq`, ascending, at most `limit`. */
  pull(afterSeq: number, limit: number): Promise<ServerRow[]>
  /** The server's clock, in ms. */
  serverTime(): Promise<Millis>
}

/** `${tbl}:${id}`: the key of a record in maps and sets (table names never contain a colon). */
export function rowKey(tbl: string, id: string): string {
  return `${tbl}:${id}`
}

/** The table and id of a `rowKey`, or null when it has no colon. */
export function parseRowKey(key: string): { tbl: string; id: string } | null {
  const at = key.indexOf(':')
  return at <= 0 ? null : { tbl: key.slice(0, at), id: key.slice(at + 1) }
}

// ─── Stamps ─────────────────────────────────────────────────────────────────

/** -1, 0 or 1: the order of two stamps. The later `at` wins; equal `at`, the larger device id wins. */
export function compareStamps(a: Stamp, b: Stamp): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1
  if (a.device !== b.device) return a.device < b.device ? -1 : 1
  return 0
}

/**
 * Whether `a` beats `b`: a strict total order over stamps, the same rule as the server trigger's
 * `(new.updated_at, new.device_id) < (old.updated_at, old.device_id)` check. Equal stamps (the same write
 * pushed twice) are not newer than each other. Device ids compare as strings by UTF-16 code unit, which is
 * PostgreSQL's order for the ids `newId()` makes (UUIDs: same length, lowercase hex, hyphens in the same
 * places, so a locale collation agrees with byte order); another id format would need `collate "C"` in the
 * trigger's comparison.
 */
export function newer(a: Stamp, b: Stamp): boolean {
  return compareStamps(a, b) > 0
}

/** The winner of two stamps (`a` when they are equal). */
export function maxStamp(a: Stamp, b: Stamp): Stamp {
  return newer(b, a) ? b : a
}

/** How far ahead of its own clock the server lets a stamp stand. */
export const STAMP_CLAMP_MS = 5 * 60_000

/** The server's cap on a stamp: never more than five minutes ahead of the server clock. */
export function clampStamp(at: Millis, serverNow: Millis): Millis {
  return Math.min(at, serverNow + STAMP_CLAMP_MS)
}

/**
 * The highest remote stamp a device may take into its clock, given the server time when known. With
 * no measurement there is no ceiling: the server has already capped every stamp it serves.
 */
export function stampCeiling(serverNow: Millis | null): number {
  return serverNow === null ? Number.POSITIVE_INFINITY : serverNow + STAMP_CLAMP_MS
}

/** One tab's stamp state: the last stamp it issued and the highest remote stamp it has seen. */
export interface StampClock {
  last: Millis
  maxSeen: Millis
}

/**
 * The next write stamp and the clock after it: `max(now, last + 1, maxSeen + 1)` (`nextStamp`). Strictly
 * increasing whatever `now` does, and past every remote stamp seen, so an edit made after seeing another
 * device's change beats it. (The one exception is a change stored at the server's cap, `serverNow + 5 min`:
 * an edit one past it is capped back to a tie if the server's clock has not moved on, which needs two
 * requests within one millisecond.)
 */
export function tickStamp(clock: StampClock, now: Millis): { at: Millis; clock: StampClock } {
  const at = nextStamp(now, clock.last, clock.maxSeen)
  return { at, clock: { last: at, maxSeen: clock.maxSeen } }
}

/** The clock after seeing a remote stamp: `maxSeen` only grows, and ignores a stamp above `ceiling`. */
export function observeRemoteStamp(
  clock: StampClock,
  remoteAt: Millis,
  ceiling: number,
): StampClock {
  if (!(remoteAt <= ceiling) || remoteAt <= clock.maxSeen) return clock
  return { last: clock.last, maxSeen: remoteAt }
}

// ─── Errors and retries ─────────────────────────────────────────────────────

/** A failed call to the server, already reduced to a kind. */
export class SyncTransportError extends Error {
  readonly kind: SyncErrorKind
  readonly status: number | null
  readonly code: string | null
  readonly retryAfterMs: number | null

  constructor(
    kind: SyncErrorKind,
    message: string,
    detail: { status?: number | null; code?: string | null; retryAfterMs?: number | null } = {},
  ) {
    super(message)
    this.name = 'SyncTransportError'
    this.kind = kind
    this.status = detail.status ?? null
    this.code = detail.code ?? null
    this.retryAfterMs = detail.retryAfterMs ?? null
  }
}

/** What went wrong with one call, as far as the transport can tell. */
export interface SyncFailure {
  /** The HTTP status, or null when there was no response (fetch rejected, or timed out). */
  status: number | null
  /** The PostgREST (`PGRST205`, `42501`, …) or GoTrue (`invalid_grant`, …) error code, when the body had one. */
  code?: string | null
  /** The 20 s `AbortSignal.timeout` fired. */
  timedOut?: boolean
  /** `navigator.onLine === false`. */
  offline?: boolean
  /** The failing call was the token refresh. */
  refresh?: boolean
}

const SIGNED_OUT_CODES: ReadonlySet<string> = new Set([
  'invalid_grant',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'user_not_found',
  'bad_jwt',
])
const RATE_LIMIT_CODES: ReadonlySet<string> = new Set([
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'over_sms_send_rate_limit',
])
const SETUP_CODES: ReadonlySet<string> = new Set(['PGRST205', '42P01', 'PGRST202'])

/**
 * Status and error code to `SyncErrorKind` (PLAN §4.7.5):
 * offline (no response, or the browser says so), server (5xx including 520–540, timeouts, and any status
 * not listed), rateLimited (429, GoTrue rate-limit codes), signedOut (a refresh refused with 400 or
 * `invalid_grant`, or a 401), setup (`PGRST205`, `42P01`, `PGRST202`), forbidden (`42501`, 403),
 * tooLarge (413). A 401 is only *classified* here: `needsRefresh` says whether to refresh and retry first.
 * `updateNeeded` and `snapshot` do not come from a response, so this never returns them.
 */
export function classifySyncError(failure: SyncFailure): SyncErrorKind {
  if (failure.offline) return 'offline'
  const { status } = failure
  const code = failure.code ?? null
  if (status === null) return failure.timedOut ? 'server' : 'offline'
  if (code !== null && RATE_LIMIT_CODES.has(code)) return 'rateLimited'
  if (status === 429) return 'rateLimited'
  if (code !== null && SIGNED_OUT_CODES.has(code)) return 'signedOut'
  if (failure.refresh && status === 400) return 'signedOut'
  if (status === 401) return 'signedOut'
  if (code !== null && SETUP_CODES.has(code)) return 'setup'
  if (status === 413) return 'tooLarge'
  if (code === '42501' || status === 403) return 'forbidden'
  return 'server'
}

/** A 401 the first time means the token expired early: refresh once and retry before calling it signed out. */
export function needsRefresh(status: number | null, alreadyRefreshed: boolean): boolean {
  return status === 401 && !alreadyRefreshed
}

/** How long before a token's expiry Forge refreshes it. */
export const REFRESH_MARGIN_MS = 60_000

/** Whether the access token is (nearly) expired: `expiresAt − 60 s < now`. */
export function tokenNeedsRefresh(expiresAt: Millis, now: Millis): boolean {
  return expiresAt - REFRESH_MARGIN_MS < now
}

/** Waits after the 1st, 2nd, 3rd and later consecutive failures (the last is the cap). */
export const BACKOFF_STEPS_MS: readonly number[] = [15_000, 60_000, 300_000, 900_000]
/** Jitter is ±20 % of the step. */
export const BACKOFF_JITTER = 0.2
/** A 429 waits at least this long when the server named no `Retry-After`. */
export const RATE_LIMIT_FLOOR_MS = 60_000
/** A `Retry-After` longer than this is treated as this long, so one odd answer cannot park sync for a day. */
export const RETRY_AFTER_CAP_MS = 60 * 60_000

/**
 * The wait after `failures` consecutive failures (1 = the first): 15 s, 1 min, 5 min, then 15 min, each
 * with ±20 % jitter. `random` is in [0, 1) and is passed in, so the result is deterministic. Reset the
 * failure count on any success.
 */
export function backoffMs(failures: number, random: number): number {
  const n = Number.isFinite(failures) ? Math.max(1, Math.floor(failures)) : 1
  const base = BACKOFF_STEPS_MS[Math.min(n, BACKOFF_STEPS_MS.length) - 1] ?? 900_000
  const r = Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0.5
  return Math.round(base * (1 + (2 * r - 1) * BACKOFF_JITTER))
}

/** `Sun, 06 Nov 1994 08:49:37 GMT`, or the obsolete `Sunday, 06-Nov-94 08:49:37 GMT`. */
const HTTP_DATE = /^[A-Za-z]{3,9}, \d{1,2}[ -][A-Za-z]{3}[ -]\d{2,4} \d{2}:\d{2}:\d{2} GMT$/

/**
 * `Retry-After` as a wait in ms from `now`: whole seconds, or an HTTP date (which always names `GMT`; a
 * lenient date parser would turn junk like `12.5` or `-5` into a date in the past). Null when absent or
 * unreadable.
 */
export function parseRetryAfter(value: string | null | undefined, now: Millis): number | null {
  if (value === null || value === undefined) return null
  const text = value.trim()
  if (/^\d+$/.test(text)) return Number(text) * 1000
  if (!HTTP_DATE.test(text)) return null
  const at = Date.parse(text)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

/** What to do after a failure. */
export type RetryPlan =
  /** Try again at this time. */
  | { mode: 'at'; at: Millis }
  /** Wait for the browser's `online` event; try again at `at` if it never comes. */
  | { mode: 'online'; at: Millis }
  /** Stop until the person acts (Sync now, sign in, reload). Tracking stays on. */
  | { mode: 'manual' }
  /** Split the batch in two and retry at once (`splitBatch`). */
  | { mode: 'shrink' }

export interface RetryContext {
  now: Millis
  /** Consecutive failures including this one (1 = the first). */
  failures: number
  /** In [0, 1), for the jitter. */
  random: number
  /** From `Retry-After`, when the response had it. */
  retryAfterMs?: number | null
}

/**
 * The schedule of PLAN §4.7.5: offline waits for `online`; server errors and a failed snapshot back off;
 * a 429 backs off but at least as long as `Retry-After` (or a minute); a 413 halves the batch; signed
 * out, setup, forbidden and update-needed stop until the person does something.
 */
export function planRetry(kind: SyncErrorKind, ctx: RetryContext): RetryPlan {
  const wait = backoffMs(ctx.failures, ctx.random)
  switch (kind) {
    case 'offline':
      return { mode: 'online', at: ctx.now + wait }
    case 'server':
    case 'snapshot':
      return { mode: 'at', at: ctx.now + wait }
    case 'rateLimited': {
      // A missing, zero or negative `Retry-After` asks for nothing: the floor applies.
      const asked =
        ctx.retryAfterMs && ctx.retryAfterMs > 0 ? ctx.retryAfterMs : RATE_LIMIT_FLOOR_MS
      return { mode: 'at', at: ctx.now + Math.max(wait, Math.min(asked, RETRY_AFTER_CAP_MS)) }
    }
    case 'tooLarge':
      return { mode: 'shrink' }
    case 'signedOut':
    case 'setup':
    case 'forbidden':
    case 'updateNeeded':
      return { mode: 'manual' }
  }
}

// ─── Merge policy and applying a pulled row ─────────────────────────────────

/**
 * How a table's rows merge. `lww`: one winner per record by stamp. `union`: an append-only log whose
 * rows are immutable, so two devices' rows only meet on a deterministic id (both paid the same award
 * offline); the sets of ids are simply united, and a same-id collision is settled without comparing
 * stamps in a first sync (the server's copy is adopted, so every device ends with the same row).
 * `xpEvents` is the union table; a tombstone still deletes (an import or restore replaces the log).
 */
export type MergePolicy = 'lww' | 'union'

export const UNION_TABLES: ReadonlySet<SyncTableName> = new Set<SyncTableName>(['xpEvents'])

export function mergePolicy(tbl: SyncTableName): MergePolicy {
  return UNION_TABLES.has(tbl) ? 'union' : 'lww'
}

export type ApplyMode = 'steady' | 'bootstrap'

export type ApplyReason =
  /** The remote stamp beats this device's pending change. */
  | 'remoteNewer'
  /** This device's change is newer: it pushes and wins on the server. */
  | 'localNewer'
  /** Our own push coming back. */
  | 'echo'
  /** No pending change: the local row is the last synced version, the server row is newer. */
  | 'lastSynced'
  /** First sync, nothing local under that key. */
  | 'absent'
  /** First sync of the settings row: the account's settings are adopted. */
  | 'adoptSettings'
  /** First sync of a union table: the server's copy is adopted. */
  | 'unionRemote'
  /** First sync, the remote stamp against the local row's `updatedAt`. */
  | 'compared'

export interface ApplyDecision {
  /** Write the remote row (or delete the local one, for a tombstone). */
  apply: boolean
  /** Remove the outbox entry for the key: the remote row replaced the local change. */
  dropPending: boolean
  reason: ApplyReason
}

export interface ApplyInput {
  mode: ApplyMode
  /** This device's id. */
  self: string
  tbl: SyncTableName
  /** The server row's stamp and whether it is a tombstone. */
  remote: Stamp & { deleted: boolean }
  /** The outbox entry for the key, if any. */
  pending: { at: Millis } | null
  /** The local row for the key (`updatedAt`), or null when there is none. */
  local: { updatedAt: Millis } | null
}

/**
 * Whether a pulled row replaces this device's state (PLAN §4.7.5, "Apply rules"), for one key:
 *
 * - a pending change: apply only if the remote stamp beats it (and drop the entry); otherwise ours is
 *   newer and will win on the server. Same in both modes;
 * - steady, no entry: skip our own push coming back, apply anything else (the server serves winners);
 * - first sync, no entry: apply when nothing is local; the account's settings are adopted; a union
 *   table's server row is adopted; otherwise apply if the remote stamp beats the local row's
 *   `updatedAt` (a device's older data never overwrites, a newer local row is queued afterwards).
 *
 * Our own stamps are compared as they stand, not as the server will cap them. A clock far ahead makes a
 * pending stamp above the remote one that is skipped here; the push is then capped at the server's time
 * at that moment, which is later than the time at which the server stored the remote row, so it still
 * wins there. Only two writes in the same millisecond at the cap can disagree (see `tickStamp`).
 */
export function decideApply(input: ApplyInput): ApplyDecision {
  const { mode, self, tbl, remote, pending, local } = input
  const remoteStamp: Stamp = { at: remote.at, device: remote.device }

  if (pending !== null) {
    const ours: Stamp = { at: pending.at, device: self }
    if (newer(remoteStamp, ours)) return { apply: true, dropPending: true, reason: 'remoteNewer' }
    const same = compareStamps(remoteStamp, ours) === 0
    return { apply: false, dropPending: false, reason: same ? 'echo' : 'localNewer' }
  }

  if (mode === 'steady') {
    if (remote.device === self) return { apply: false, dropPending: false, reason: 'echo' }
    return { apply: true, dropPending: false, reason: 'lastSynced' }
  }

  if (local === null) return { apply: true, dropPending: false, reason: 'absent' }
  if (tbl === 'settings' && !remote.deleted) {
    return { apply: true, dropPending: false, reason: 'adoptSettings' }
  }
  if (mergePolicy(tbl) === 'union' && !remote.deleted) {
    return { apply: true, dropPending: false, reason: 'unionRemote' }
  }
  const apply = newer(remoteStamp, { at: local.updatedAt, device: self })
  return { apply, dropPending: false, reason: 'compared' }
}

// ─── The settings row ───────────────────────────────────────────────────────

function getPath(obj: Obj, path: string): { found: boolean; value: unknown } {
  const [head, leaf] = path.split('.') as [string, string | undefined]
  if (leaf === undefined)
    return head in obj ? { found: true, value: obj[head] } : { found: false, value: undefined }
  const inner = obj[head]
  if (isObj(inner) && leaf in inner) return { found: true, value: inner[leaf] }
  return { found: false, value: undefined }
}

function setPath(obj: Obj, path: string, value: unknown): void {
  const [head, leaf] = path.split('.') as [string, string | undefined]
  if (leaf === undefined) {
    obj[head] = value
    return
  }
  obj[head] = { ...(isObj(obj[head]) ? obj[head] : {}), [leaf]: value }
}

/**
 * The settings row to write when the server's arrives (PLAN §4.7.4): the remote row, except that
 * every device-only field (`SETTINGS_DEVICE_PATHS`: theme and accent, notification permission, the
 * blocker's extension id and cursors, the backup nudge) keeps this device's value, and `onboardedAt`
 * never goes from set to null (the earliest non-null one wins). Device fields the remote row carries
 * (an older client did not strip them) are ignored. When there is no local row (`local` is not an
 * object), the device fields come from `fallback` (the defaults), and are left out if that has none.
 * Returns null when `remote` is not an object. Neither argument is changed.
 */
export function mergeRemoteSettings(
  local: unknown,
  remote: unknown,
  fallback?: unknown,
): Obj | null {
  const synced = syncedSettings(remote)
  if (synced === null) return null
  const out: Obj = synced
  const deviceSource = isObj(local) ? local : isObj(fallback) ? fallback : null
  if (deviceSource !== null) {
    for (const path of SETTINGS_DEVICE_PATHS) {
      const found = getPath(deviceSource, path)
      if (found.found) setPath(out, path, found.value)
    }
  }
  const stamps = [isObj(local) ? local.onboardedAt : undefined, out.onboardedAt].filter(
    (v): v is number => typeof v === 'number',
  )
  if (stamps.length > 0) out.onboardedAt = Math.min(...stamps)
  return out
}

// ─── Pushing ────────────────────────────────────────────────────────────────

export interface PushContext {
  /** This device's id, the stamp's tie-break. */
  deviceId: string
  /** The schema version the row is written at (`SCHEMA_VERSION`). */
  schemaVersion: number
}

export type PushDecision =
  | { kind: 'push'; row: PushRow }
  /** Nothing goes to the server for this entry; remove it. */
  | { kind: 'drop'; reason: 'inProgress' | 'notSynced' }

/**
 * The server row for one outbox entry, reading the record now (`local` is the row, or undefined/null
 * when it is gone: a tombstone). The settings row loses its device-only fields, trash entries lose their
 * attached files' bytes (a `{ __blob, type, size }` marker stays), and a running or paused session is
 * not pushed at all: it goes when it ends, so no device finishes another device's timer.
 */
export function toServerRow(
  entry: SyncOutboxEntry,
  local: unknown,
  ctx: PushContext,
): PushDecision {
  if (!isSyncTable(entry.tbl)) return { kind: 'drop', reason: 'notSynced' }
  const base = {
    tbl: entry.tbl,
    id: entry.id,
    updatedAt: entry.at,
    deviceId: ctx.deviceId,
    schemaVersion: ctx.schemaVersion,
  }
  if (local === undefined || local === null) {
    return { kind: 'push', row: { ...base, deleted: true, data: null } }
  }
  if (
    entry.tbl === 'sessions' &&
    isObj(local) &&
    (local.status === 'running' || local.status === 'paused')
  ) {
    return { kind: 'drop', reason: 'inProgress' }
  }
  let data: unknown = local
  if (entry.tbl === 'settings') data = syncedSettings(local) ?? local
  else if (entry.tbl === 'trash') data = markTrashBlobs([local])[0]
  return { kind: 'push', row: { ...base, deleted: false, data } }
}

/** Outbox entries in push order: by stamp, then table and id, so the order is the same everywhere. */
export function orderOutbox<T extends SyncOutboxEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) =>
      a.at - b.at ||
      (a.tbl < b.tbl ? -1 : a.tbl > b.tbl ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** Outbox entries read per push round. */
export const PUSH_ENTRY_LIMIT = 200

/** The next round of a push: the oldest entries first. */
export function nextPushEntries<T extends SyncOutboxEntry>(
  entries: readonly T[],
  limit: number = PUSH_ENTRY_LIMIT,
): T[] {
  return orderOutbox(entries).slice(0, Math.max(0, limit))
}

/**
 * Whether an entry pushed with stamp `pushedAt` may be removed after the server accepted it: only if it
 * still carries that stamp. A record edited during the request has a newer stamp and stays queued.
 */
export function isSettled(pushedAt: Millis, currentAt: Millis | undefined): boolean {
  return currentAt === pushedAt
}

// ─── Batching ───────────────────────────────────────────────────────────────

/** A push body is cut at about this many bytes. */
export const BATCH_MAX_BYTES = 1_000_000
/** One row bigger than this is never sent (reported as `tooLarge`, naming the record). */
export const ROW_MAX_BYTES = 8_000_000
/** A `keepalive` fetch may carry at most 64 KB; the flush on hiding the page stays under this. */
export const KEEPALIVE_MAX_BYTES = 60_000
/** What a row costs on the wire beyond its own JSON: `user_id`, the longer snake_case keys, the comma. */
export const ROW_OVERHEAD_BYTES = 64

const encoder = new TextEncoder()

/** Bytes of `text` as UTF-8. */
export function utf8Length(text: string): number {
  return encoder.encode(text).length
}

/** The size of a row in a push body: its JSON in UTF-8 plus `ROW_OVERHEAD_BYTES`. */
export function pushRowBytes(row: PushRow): number {
  return utf8Length(JSON.stringify(row)) + ROW_OVERHEAD_BYTES
}

export interface Batches {
  /** Groups to push one request each, in the order given. */
  batches: PushRow[][]
  /** Rows over `maxRowBytes`: not sent, to be reported. */
  tooLarge: PushRow[]
}

/**
 * Cuts rows into batches of at most `maxBytes` (about 1 MB), keeping their order. A row bigger than the
 * batch limit but within `maxRowBytes` goes alone; a row over `maxRowBytes` is not sent at all.
 */
export function batchRows(
  rows: readonly PushRow[],
  opts: { maxBytes?: number; maxRowBytes?: number } = {},
): Batches {
  const maxBytes = opts.maxBytes ?? BATCH_MAX_BYTES
  const maxRowBytes = opts.maxRowBytes ?? ROW_MAX_BYTES
  const batches: PushRow[][] = []
  const tooLarge: PushRow[] = []
  let current: PushRow[] = []
  let bytes = 0
  for (const row of rows) {
    const size = pushRowBytes(row)
    if (size > maxRowBytes) {
      tooLarge.push(row)
      continue
    }
    if (current.length > 0 && bytes + size > maxBytes) {
      batches.push(current)
      current = []
      bytes = 0
    }
    current.push(row)
    bytes += size
  }
  if (current.length > 0) batches.push(current)
  return { batches, tooLarge }
}

/** A batch the server refused as too large, in two halves; null when one row is left (skip and report it). */
export function splitBatch<T>(batch: readonly T[]): [T[], T[]] | null {
  if (batch.length < 2) return null
  const middle = Math.ceil(batch.length / 2)
  return [batch.slice(0, middle), batch.slice(middle)]
}

/** Whether these rows can go in one `keepalive` request, the flush when the page is hidden. */
export function fitsKeepalive(rows: readonly PushRow[]): boolean {
  let bytes = 2
  for (const row of rows) {
    bytes += pushRowBytes(row)
    if (bytes > KEEPALIVE_MAX_BYTES) return false
  }
  return true
}

// ─── Pulling ────────────────────────────────────────────────────────────────

/** Rows per pull request. */
export const PULL_PAGE_SIZE = 500

/** Where a pull stands between pages. */
export interface PullProgress {
  /** The highest `seq` applied; the next request asks for `seq > cursor`. */
  cursor: number
  maxSeenStamp: Millis
  pages: number
  rows: number
}

export interface PullStep {
  progress: PullProgress
  /** The page's rows past the cursor, ascending by `seq`: what to apply. */
  rows: ServerRow[]
  /** A short page: nothing more to fetch. */
  done: boolean
  /** A full page that moved nothing (a server that ignores the cursor): stop rather than loop. */
  stalled: boolean
}

export function startPull(cursor: number, maxSeenStamp: Millis): PullProgress {
  return { cursor, maxSeenStamp, pages: 0, rows: 0 }
}

/**
 * The state after fetching one page. The cursor moves to the highest `seq` in the page and never back;
 * rows at or below the cursor are dropped; `maxSeenStamp` takes the page's stamps up to `ceiling`
 * (`stampCeiling`). A page shorter than `limit` ends the pull.
 */
export function advancePull(
  progress: PullProgress,
  page: readonly ServerRow[],
  opts: { limit?: number; ceiling?: number } = {},
): PullStep {
  const limit = opts.limit ?? PULL_PAGE_SIZE
  const ceiling = opts.ceiling ?? Number.POSITIVE_INFINITY
  const rows = page.filter((r) => r.seq > progress.cursor).sort((a, b) => a.seq - b.seq)
  let cursor = progress.cursor
  let maxSeen = progress.maxSeenStamp
  for (const row of rows) {
    if (row.seq > cursor) cursor = row.seq
    if (row.updatedAt <= ceiling && row.updatedAt > maxSeen) maxSeen = row.updatedAt
  }
  const done = page.length < limit
  return {
    progress: {
      cursor,
      maxSeenStamp: maxSeen,
      pages: progress.pages + 1,
      rows: progress.rows + rows.length,
    },
    rows,
    done,
    stalled: !done && rows.length === 0,
  }
}

/** Rows a cycle's pull deletes here at which the device takes a `pre-sync` snapshot first (an import, a
 * snapshot restore or a big delete elsewhere). Counted over the whole cycle, not per page. */
export const SAFETY_SNAPSHOT_DELETIONS = 25

/**
 * Rows written at schema version `from` as rows of version `to`, one table at a time, with the backup
 * migrators (v1 → v2 the planner fields, v2 → v3 the settings row loses `sync`). Rows already at or past
 * `to` come back unchanged.
 */
export function migrateRows(
  tbl: string,
  rows: readonly unknown[],
  from: number,
  to: number,
  now: Millis,
): unknown[] {
  let out: unknown[] = [...rows]
  if (from < 2 && to >= 2) {
    out = migrateRowsV1toV2({ [tbl]: out }, now)[tbl] ?? out
    if (tbl === 'trash') out = out.map((r) => trashToV2(r, now))
  }
  if (from < 3 && to >= 3 && tbl === 'settings') out = out.map((r) => settingsToV3(r))
  return out
}

/** What to do with one pulled row. */
export type RowVerdict =
  /** Write `data` (migrated to the current schema) under the row's key. */
  | { kind: 'put'; row: ServerRow; data: Obj }
  /** Delete the local row. */
  | { kind: 'delete'; row: ServerRow }
  /** `data` is not an object with a string `id` equal to the key: skip and count it. */
  | { kind: 'invalid'; row: ServerRow }
  /** A table this Forge does not know (and not a newer schema): skip. */
  | { kind: 'unknownTable'; row: ServerRow }

export interface PageVerdicts {
  /** A row was written by a newer Forge: stop before writing this page and keep the cursor. */
  updateNeeded: boolean
  verdicts: RowVerdict[]
}

/**
 * One pulled row as the engine should treat it: a tombstone deletes, an older row is migrated up to
 * `currentSchema`, a row whose data does not match its key is invalid, and a table Forge does not have
 * is unknown. (A row from a newer schema is handled per page, in `classifyPage`.)
 */
export function prepareRemoteRow(row: ServerRow, currentSchema: number, now: Millis): RowVerdict {
  if (!isSyncTable(row.tbl)) return { kind: 'unknownTable', row }
  if (row.deleted) return { kind: 'delete', row }
  const migrated =
    row.schemaVersion < currentSchema
      ? migrateRows(row.tbl, [row.data], row.schemaVersion, currentSchema, now)[0]
      : row.data
  if (!isObj(migrated) || typeof migrated.id !== 'string' || migrated.id !== row.id) {
    return { kind: 'invalid', row }
  }
  return { kind: 'put', row, data: migrated }
}

/** The first row of a page that a newer Forge wrote (`schemaVersion` above `currentSchema`), if any. */
export function findNewerSchema(
  page: readonly ServerRow[],
  currentSchema: number,
): ServerRow | undefined {
  return page.find((r) => r.schemaVersion > currentSchema)
}

/**
 * A page ready to apply: every row's verdict, or `updateNeeded` and no verdicts when any row comes from
 * a newer schema ("Another device runs a newer Forge"; nothing of that page is written).
 */
export function classifyPage(
  page: readonly ServerRow[],
  currentSchema: number,
  now: Millis,
): PageVerdicts {
  if (findNewerSchema(page, currentSchema) !== undefined)
    return { updateNeeded: true, verdicts: [] }
  return { updateNeeded: false, verdicts: page.map((r) => prepareRemoteRow(r, currentSchema, now)) }
}

// ─── First sync of a device ─────────────────────────────────────────────────

/** A row of the account, as the first sync indexes it while pulling: its key's stamp and whether it is a tombstone. */
export interface RemoteIndexEntry extends Stamp {
  deleted: boolean
}

/** The account's seed rows by signature, built while pulling (which ids carry each title or entry). */
export interface RemoteSeedIndex {
  rewardTitles: Map<string, Set<string>>
  onboardingTaskTitles: Map<string, Set<string>>
  blocklist: Map<string, Set<string>>
}

export function emptySeedIndex(): RemoteSeedIndex {
  return { rewardTitles: new Map(), onboardingTaskTitles: new Map(), blocklist: new Map() }
}

/** `kind|domain|pattern`, the identity of a blocklist entry apart from its id. */
export function blockSignature(kind: unknown, domain: unknown, pattern: unknown): string {
  const d = typeof domain === 'string' ? domain.trim().toLowerCase() : ''
  return `${typeof kind === 'string' ? kind : ''}|${d}|${typeof pattern === 'string' ? pattern : ''}`
}

function addTo(map: Map<string, Set<string>>, key: string, id: string): void {
  const ids = map.get(key)
  if (ids) ids.add(id)
  else map.set(key, new Set([id]))
}

/** Adds one live server row to the index (rewards, onboarding tasks and blocklist entries; the rest are ignored). */
export function indexRemoteSeedRow(
  index: RemoteSeedIndex,
  row: { tbl: string; id: string; deleted: boolean; data: unknown },
): void {
  if (row.deleted || !isObj(row.data)) return
  const { data } = row
  if (row.tbl === 'rewards' && typeof data.title === 'string') {
    addTo(index.rewardTitles, data.title, row.id)
  } else if (
    row.tbl === 'tasks' &&
    data.source === 'onboarding' &&
    typeof data.title === 'string'
  ) {
    addTo(index.onboardingTaskTitles, data.title, row.id)
  } else if (row.tbl === 'blocklist') {
    addTo(index.blocklist, blockSignature(data.kind, data.domain, data.pattern), row.id)
  }
}

/** The local rows `seedDuplicates` looks at (extra fields are ignored). */
export interface LocalSeedRows {
  rewards: readonly { id: string; title: string; createdAt: Millis; updatedAt: Millis }[]
  tasks: readonly {
    id: string
    title: string
    source: string
    status: string
    createdAt: Millis
    updatedAt: Millis
  }[]
  blocklist: readonly {
    id: string
    kind: string
    domain: string
    pattern: string | null
    createdAt: Millis
    updatedAt: Millis
  }[]
}

/**
 * Local rows that exist only because this device seeded them, and that the account already has under
 * another id: to be deleted locally, without tombstones (PLAN §4.7.5, first sync step 3).
 *  - an untouched starter reward (`updatedAt === createdAt`, one of `starterRewardTitles`) when the
 *    account has a reward of that title;
 *  - an untouched onboarding starter task (`source: 'onboarding'`, `todo`, `updatedAt === createdAt`)
 *    when the account has an onboarding task of that title;
 *  - an untouched blocklist entry (`updatedAt` fewer than `defaultSiteCount` ms from `createdAt`, the
 *    rule of `accountWinsOverSeed`) whose `(kind, domain, pattern)` the account already has. One the
 *    person switched off or edited here is theirs, and stays (a duplicate beats a lost edit).
 * The caller also drops these keys' outbox entries.
 */
export function seedDuplicates(
  local: LocalSeedRows,
  remote: RemoteSeedIndex,
  starterRewardTitles: ReadonlySet<string>,
  defaultSiteCount: number,
): { tbl: 'rewards' | 'tasks' | 'blocklist'; id: string }[] {
  const otherThan = (ids: ReadonlySet<string> | undefined, id: string): boolean =>
    ids !== undefined && [...ids].some((other) => other !== id)
  const out: { tbl: 'rewards' | 'tasks' | 'blocklist'; id: string }[] = []
  for (const r of local.rewards) {
    if (
      r.updatedAt === r.createdAt &&
      starterRewardTitles.has(r.title) &&
      otherThan(remote.rewardTitles.get(r.title), r.id)
    ) {
      out.push({ tbl: 'rewards', id: r.id })
    }
  }
  for (const t of local.tasks) {
    if (
      t.source === 'onboarding' &&
      t.status === 'todo' &&
      t.updatedAt === t.createdAt &&
      otherThan(remote.onboardingTaskTitles.get(t.title), t.id)
    ) {
      out.push({ tbl: 'tasks', id: t.id })
    }
  }
  for (const b of local.blocklist) {
    if (
      Math.abs(b.updatedAt - b.createdAt) < defaultSiteCount &&
      otherThan(remote.blocklist.get(blockSignature(b.kind, b.domain, b.pattern)), b.id)
    ) {
      out.push({ tbl: 'blocklist', id: b.id })
    }
  }
  return out
}

/** A local row as the first sync sees it. */
export interface LocalRowStamp {
  tbl: SyncTableName
  id: string
  updatedAt: Millis
}

/**
 * Structural equality of two rows as JSON carries them: objects by own enumerable keys (an `undefined`
 * value counts as absent, as it does after a JSON round trip) in any order, arrays by position,
 * everything else by `===`. An object that is not plain (a `Blob`, a `Date`) is only equal to itself.
 */
export function sameRow(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameRow(item, b[i]))
    )
  }
  const plain = (o: object): boolean => {
    const proto: unknown = Object.getPrototypeOf(o)
    return proto === Object.prototype || proto === null
  }
  if (!plain(a) || !plain(b)) return false
  const left = Object.entries(a).filter(([, v]) => v !== undefined)
  const right = Object.entries(b).filter(([, v]) => v !== undefined)
  if (left.length !== right.length) return false
  const other = new Map(right)
  return left.every(([key, v]) => other.has(key) && sameRow(v, other.get(key)))
}

/**
 * Keeps `identical` (the `planBootstrapQueue` input of the same name) up to date while a first sync
 * pulls: call it once per pulled row, after the row was applied or skipped, with the local row as it
 * then stands (`undefined` when there is none). A live row whose local copy equals the account's is in
 * the set; any other outcome takes the key out again, so the last row seen for a key decides. The
 * settings row is never identical (its device-only fields differ by design; `planBootstrapQueue` has its
 * own rule for it). A row just written from the account is identical by construction, and so is one an
 * interrupted first sync wrote in an earlier run.
 */
export function noteIdenticalRow(
  identical: Set<string>,
  verdict: RowVerdict,
  local: unknown,
): void {
  const key = rowKey(verdict.row.tbl, verdict.row.id)
  if (verdict.kind === 'put' && verdict.row.tbl !== 'settings' && sameRow(local, verdict.data)) {
    identical.add(key)
  } else {
    identical.delete(key)
  }
}

/**
 * What this device adds to the account after pulling everything (PLAN §4.7.5, first sync step 4): an
 * outbox entry for every local row with no entry yet whose key the account lacks, or whose
 * `{ at: updatedAt, device: self }` beats the account's stamp. The entry's `at` is the row's `updatedAt`,
 * not now: a phone's week-old default must not beat the laptop's edit of yesterday. The settings row is
 * queued only when the account has none, and a union table's row the account already has is never
 * queued (the server's copy was adopted).
 *
 * A row **identical** to the account's (`identical`, see `noteIdenticalRow`) is never queued, whatever
 * the stamps say: it is the account's own data, adopted in this run or an interrupted earlier one. Its
 * `updatedAt` is the writer's clock, so it can be above the stamp the server stored (a tie, or a writer
 * more than five minutes ahead, whose stamp the server capped). Sent again it would be stored at this
 * device's push time + 5 minutes, above anything this device's clock has seen, and this device's own
 * next edit or delete of the row would lose to that copy. Comparing `updatedAt` alone does not do:
 * different content can share one.
 */
export function planBootstrapQueue(input: {
  self: string
  local: readonly LocalRowStamp[]
  /** `rowKey`s that already have an outbox entry. */
  queued: ReadonlySet<string>
  /** The account's rows by `rowKey`, tombstones included. */
  remote: ReadonlyMap<string, RemoteIndexEntry>
  /** `rowKey`s whose local row equals the account's row (`noteIdenticalRow`). */
  identical: ReadonlySet<string>
}): SyncOutboxEntry[] {
  const out: SyncOutboxEntry[] = []
  for (const row of input.local) {
    const key = rowKey(row.tbl, row.id)
    if (input.queued.has(key) || input.identical.has(key)) continue
    const theirs = input.remote.get(key)
    if (theirs !== undefined) {
      if (!theirs.deleted && (row.tbl === 'settings' || mergePolicy(row.tbl) === 'union')) continue
      if (!newer({ at: row.updatedAt, device: input.self }, theirs)) continue
    }
    out.push({ tbl: row.tbl, id: row.id, at: row.updatedAt })
  }
  return orderOutbox(out)
}
