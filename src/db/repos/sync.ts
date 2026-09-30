/**
 * The sync engine's database side (PLAN §4.7.5). Everything it decides is pure (`logic/sync.ts`,
 * `logic/syncApply.ts`); this file reads and writes the tables and talks to a `SyncServer`, which is the
 * Supabase transport in the app and `src/test/fakeSyncServer.ts` in tests. Features reach sync only
 * through this file, `syncGate.ts` and `hooks/useSyncState.ts`.
 *
 * A cycle (`runSyncCycle`, one at a time):
 *  1. no `syncState` row, or not enabled: nothing happens;
 *  2. the session is refreshed when it is about to expire (the `refresh` option), and the server's clock
 *     is measured (at most hourly);
 *  3. a device's first sync (`phase: 'bootstrap'`) is a merge and never a wipe: a `pre-sync` snapshot,
 *     pull everything with the bootstrap rules, drop the seed rows the account already has, queue what
 *     this device adds, push it;
 *  4. otherwise: push the outbox in batches with compare-and-delete, then pull by `seq` cursor, one
 *     Dexie transaction per page of 500 rows, marked remote-apply so nothing is queued or re-stamped;
 *  5. `lastSyncAt` and `lastError` are written and `sync.applied` is emitted once, for the handlers that
 *     rebuild what is derived from history.
 *
 * A failure never throws: it is written to `syncState.lastError` and returned with what the caller
 * needs to schedule a retry (`planRetry`). Every write to `syncState` and every apply checks that the
 * row still belongs to this cycle's device, so signing out mid-cycle cannot bring the state back.
 */
import { newId } from '@/lib/ids'
import { yieldToMain } from '@/lib/idle'
import { appVersion } from '@/lib/appVersion'
import {
  PULL_PAGE_SIZE,
  PUSH_ENTRY_LIMIT,
  SyncTransportError,
  advancePull,
  batchRows,
  classifyPage,
  decideApply,
  emptySeedIndex,
  indexRemoteSeedRow,
  isSettled,
  mergeRemoteSettings,
  needsSafetySnapshot,
  nextPushEntries,
  noteIdenticalRow,
  planBootstrapQueue,
  rowKey,
  sameRow,
  seedDuplicates,
  splitBatch,
  startPull,
  stampCeiling,
  toServerRow,
  tokenNeedsRefresh,
  SAFETY_SNAPSHOT_DELETIONS,
  type ApplyMode,
  type LocalRowStamp,
  type PullProgress,
  type PushRow,
  type RemoteIndexEntry,
  type RemoteSeedIndex,
  type RowVerdict,
  type SyncServer,
} from '@/logic/sync'
import {
  SYNC_TEXT,
  clockCheckDue,
  clockSkew,
  isRowRejection,
  keepLocalTrashBlobs,
  levelToAbsorb,
  planTaskGoalId,
  recordLabel,
  trashFilesToRescue,
} from '@/logic/syncApply'
import { filesInTrash, markTrashBlobs } from '@/logic/snapshotJson'
import { SYNC_TABLES, isSyncTable, type SyncTableName } from '@/logic/syncTables'
import { levelFromLifetimeXp, lifetimeXp } from '@/logic/xp'
import { db } from '../db'
import { SETTINGS_ID, defaultSettings, defaultSyncState } from '../defaults'
import { emit } from '../events'
import { SCHEMA_VERSION } from '../schema'
import { markRemoteApply, markUntracked } from '../sync/remoteApply'
import { SYNC_STATE_ID } from '../sync/tracking'
import type {
  ID,
  Millis,
  Resource,
  SyncError,
  SyncOutboxEntry,
  SyncSession,
  StoredFile,
  SyncStateRow,
  TableName,
  XpEvent,
} from '../types'
import { STARTER_REWARDS } from './rewards'
import { takeSnapshot } from './snapshots'
import { settleStartupSync } from './syncGate'

type Row = Record<string, unknown>
type Key = [string, string]

const rowsOf = (name: SyncTableName) => db.table(name)

/** The error a failed snapshot turns into, with what really went wrong attached for the error log. */
function snapshotFailure(cause: unknown): SyncTransportError {
  const error = new SyncTransportError('snapshot', SYNC_TEXT.snapshot)
  error.cause = cause
  return error
}

// ─── Reading and keeping this device's sync state ───────────────────────────

/** This device's sync row, or undefined when sync was never set up. */
export function getSyncState(): Promise<SyncStateRow | undefined> {
  return db.syncState.get(SYNC_STATE_ID)
}

/** The signed-in session (tokens included: never log or show it), or null. For sign-out and the transport. */
export async function getSyncSession(): Promise<SyncSession | null> {
  return (await getSyncState())?.session ?? null
}

/** Changes waiting to be pushed. */
export function pendingChangeCount(): Promise<number> {
  return db.syncOutbox.count()
}

async function writeState(mutate: (row: SyncStateRow) => SyncStateRow): Promise<SyncStateRow> {
  return db.transaction('rw', db.syncState, async () => {
    const next = mutate((await db.syncState.get(SYNC_STATE_ID)) ?? defaultSyncState())
    await db.syncState.put(next)
    return next
  })
}

/** The project and the address sign-in emails go to: `url` and `anonKey` from a validated config. Sync stays off. */
export function saveSyncConfig(config: {
  url: string
  anonKey: string
  email?: string | null
}): Promise<SyncStateRow> {
  return writeState((row) => ({
    ...row,
    url: config.url,
    anonKey: config.anonKey,
    email: config.email === undefined ? row.email : config.email,
  }))
}

/** The sign-in in progress (the PKCE verifier and where the link went), or null to forget it. */
export async function savePendingLogin(pending: SyncStateRow['pendingLogin']): Promise<void> {
  await writeState((row) => ({ ...row, pendingLogin: pending }))
}

/**
 * The person signed in: sync is on for this device. A sign-in to the account this device already syncs
 * with just stores the session (after "Sign in again"); anything else, turning it on for the first time
 * or signing in to another account, is a first sync with a new device id (`phase: 'bootstrap'`). Tracking
 * starts in every open tab. The enabling tab should wait about a second before the first cycle, so the
 * other tabs have heard it.
 */
export async function startSync(session: SyncSession): Promise<SyncStateRow> {
  const next = await writeState((row) => {
    const continuing =
      row.enabled && row.deviceId !== null && row.accountUserId === session.userId
    return {
      ...row,
      enabled: true,
      email: session.email,
      session,
      pendingLogin: null,
      lastError: null,
      ...(continuing
        ? {}
        : {
            deviceId: newId(),
            accountUserId: session.userId,
            phase: 'bootstrap' as const,
            pullCursor: 0,
            preSyncFor: null,
          }),
    }
  })
  db.syncTracker.seed({ maxSeenStamp: next.maxSeenStamp })
  db.syncTracker.setEnabled(true, { broadcast: true })
  return next
}

/** A refreshed session from the engine between cycles (inside a cycle the engine does it itself). */
export async function saveSession(session: SyncSession): Promise<boolean> {
  return db.transaction('rw', db.syncState, async () => {
    const row = await db.syncState.get(SYNC_STATE_ID)
    if (!row?.enabled) return false
    await db.syncState.put({ ...row, session, lastError: null })
    return true
  })
}

/**
 * The sign-in no longer works: the tokens are dropped and the person is asked to sign in again. Tracking
 * stays on and the outbox keeps growing until they do (PLAN §4.7.5).
 */
export async function markSignedOut(at: Millis): Promise<void> {
  await db.transaction('rw', db.syncState, async () => {
    const row = await db.syncState.get(SYNC_STATE_ID)
    if (!row?.enabled) return
    await db.syncState.put({
      ...row,
      session: null,
      lastError: { kind: 'signedOut', message: SYNC_TEXT.signedOut, at },
    })
  })
}

/**
 * "Sign out and stop syncing": tracking off in every tab, the outbox cleared, and `syncState` back to
 * its defaults except the project and the email. Local data and the cloud copy are untouched, and
 * turning sync on again is a new first sync. (The best-effort `logout` call is the caller's: read the
 * session with `getSyncSession()` first.)
 */
export async function stopSync(): Promise<void> {
  db.syncTracker.setEnabled(false, { broadcast: true })
  await db.transaction('rw', db.syncState, db.syncOutbox, async () => {
    const row = await db.syncState.get(SYNC_STATE_ID)
    if (row) await db.syncState.put(defaultSyncState(row))
    await db.syncOutbox.clear()
  })
}

// ─── Options, results ───────────────────────────────────────────────────────

export interface SyncProgress {
  step: 'snapshot' | 'pull' | 'merge' | 'push'
  /** Rows handled so far in this step. */
  rows: number
}

export interface SyncCycleOptions {
  /** The clock in ms (default `Date.now`). */
  now?: () => Millis
  /** The app version written into a `pre-sync` snapshot. */
  appVersion?: string
  /**
   * Exchanges the refresh token for a new session (`features/sync/supabase/auth.refreshSession`), and
   * makes the `SyncServer` use it from then on. Called before the cycle when the token is about to
   * expire, and once after a call was answered with a sign-in failure. If the answer to a refresh was
   * lost (an offline or server error) it is tried once more at once; a refresh that is then refused
   * (`refresh_token_already_used` and the like) ends the cycle with `signedOut`.
   */
  refresh?: (session: SyncSession) => Promise<SyncSession>
  /** Progress for a quiet count in the first-sync state. */
  onProgress?: (progress: SyncProgress) => void
  /** Gives the main thread back between pages and batches (default `yieldToMain`). */
  yieldNow?: () => Promise<void>
}

/** A record the server would not take (too large, or refused): left out, reported, never retried until edited. */
export interface RefusedRecord {
  tbl: SyncTableName
  id: string
  reason: 'tooLarge' | 'refused'
  label: string
}

export type SyncCycleResult =
  /** Sync is off, or was switched off during the cycle. */
  | { status: 'off' }
  /** Another cycle of this page is running. */
  | { status: 'busy' }
  | {
      status: 'ok'
      mode: ApplyMode
      pushed: number
      /** Rows the server returned past the cursor. */
      pulled: number
      /** Rows written or deleted here. */
      applied: number
      refused: RefusedRecord[]
    }
  | {
      status: 'error'
      /** Also in `syncState.lastError`. */
      error: SyncError
      /** What to hand to `planRetry`. */
      retryAfterMs: number | null
      httpStatus: number | null
      /** An error that is not a transport failure (a database error): for the error log. */
      cause?: unknown
    }

// ─── Cycle plumbing ─────────────────────────────────────────────────────────

class CycleCancelled extends Error {
  constructor() {
    super('The sync was switched off during the cycle')
    this.name = 'CycleCancelled'
  }
}

interface BootstrapIndex {
  remote: Map<string, RemoteIndexEntry>
  seed: RemoteSeedIndex
  identical: Set<string>
}

interface Ctx {
  server: SyncServer
  opts: SyncCycleOptions
  now: () => Millis
  deviceId: string
  userId: string | null
  version: string
  /** Server minus device clock, from the last measurement; null when never measured. */
  skew: number | null
  refreshed: boolean
  snapshotTaken: boolean
  pushed: number
  pulled: number
  applied: number
  touched: Set<TableName>
  goalIds: Set<ID>
  refused: RefusedRecord[]
  yieldNow: () => Promise<void>
  report: (step: SyncProgress['step'], rows: number) => void
}

/** The most rows one cycle will skip before it decides something is wrong with the request, not the rows. */
const MAX_REFUSED = 10
/** Bound on push rounds of 200 entries: a safety net against an outbox that never drains. */
const MAX_PUSH_ROUNDS = 2000

let running = false
const clockChecks = new Map<string, Millis>()

/** Writes `patch` to this device's `syncState`, unless the row no longer belongs to this cycle. */
async function patchState(ctx: Ctx, patch: Partial<SyncStateRow>): Promise<SyncStateRow> {
  return db.transaction('rw', db.syncState, async () => {
    const row = await db.syncState.get(SYNC_STATE_ID)
    if (!row?.enabled || row.deviceId !== ctx.deviceId) throw new CycleCancelled()
    const next = { ...row, ...patch }
    await db.syncState.put(next)
    return next
  })
}

const ceilingOf = (ctx: Ctx): number =>
  stampCeiling(ctx.skew === null ? null : ctx.now() + ctx.skew)

/** One server call; a sign-in failure refreshes the session once and repeats the call. */
async function call<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (
      !(error instanceof SyncTransportError) ||
      error.kind !== 'signedOut' ||
      !ctx.opts.refresh ||
      ctx.refreshed
    ) {
      throw error
    }
    await refreshSession(ctx)
    return fn()
  }
}

async function refreshSession(ctx: Ctx): Promise<void> {
  ctx.refreshed = true
  const refresh = ctx.opts.refresh
  const current = await getSyncSession()
  if (!refresh || !current) throw new SyncTransportError('signedOut', SYNC_TEXT.signedOut)
  let next: SyncSession
  try {
    next = await refresh(current)
  } catch (error) {
    // The answer may have been lost after Supabase rotated the token; its short reuse window lets the
    // same token through once more. If that is refused too, the person has to sign in again.
    if (
      error instanceof SyncTransportError &&
      (error.kind === 'offline' || error.kind === 'server')
    ) {
      next = await refresh(current)
    } else {
      throw error
    }
  }
  await patchState(ctx, { session: next, lastError: null })
}

async function measureClock(ctx: Ctx, stored: number | null): Promise<number | null> {
  if (!clockCheckDue(clockChecks.get(ctx.deviceId) ?? null, ctx.now())) return stored
  const sent = ctx.now()
  const serverNow = await call(ctx, () => ctx.server.serverTime())
  const received = ctx.now()
  clockChecks.set(ctx.deviceId, received)
  return clockSkew(serverNow, sent, received)
}

// ─── Push ───────────────────────────────────────────────────────────────────

interface BuiltRows {
  items: { entry: SyncOutboxEntry; row: PushRow }[]
  /** Entries with nothing to send (a running session, a table that never syncs). */
  dropped: SyncOutboxEntry[]
  /** Records as read, for naming a refused one. */
  records: Map<string, unknown>
}

/** Reads each record now and builds its server row: a missing record is a tombstone. */
async function buildRows(deviceId: string, entries: readonly SyncOutboxEntry[]): Promise<BuiltRows> {
  const byTable = new Map<SyncTableName, SyncOutboxEntry[]>()
  const dropped: SyncOutboxEntry[] = []
  for (const entry of entries) {
    if (!isSyncTable(entry.tbl)) {
      dropped.push(entry)
      continue
    }
    const list = byTable.get(entry.tbl)
    if (list) list.push(entry)
    else byTable.set(entry.tbl, [entry])
  }
  const records = new Map<string, unknown>()
  if (byTable.size > 0) {
    await db.transaction(
      'r',
      [...byTable.keys()].map(rowsOf),
      async () => {
        for (const [tbl, list] of byTable) {
          const found = await rowsOf(tbl).bulkGet(list.map((e) => e.id))
          list.forEach((e, i) => records.set(rowKey(tbl, e.id), found[i]))
        }
      },
    )
  }
  const items: BuiltRows['items'] = []
  for (const entry of entries) {
    if (!isSyncTable(entry.tbl)) continue
    const decision = toServerRow(entry, records.get(rowKey(entry.tbl, entry.id)), {
      deviceId,
      schemaVersion: SCHEMA_VERSION,
    })
    if (decision.kind === 'drop') dropped.push(entry)
    else items.push({ entry, row: decision.row })
  }
  return { items, dropped, records }
}

/**
 * Compare-and-delete: an entry goes only if its stamp is still the one that was pushed, so a record
 * edited during the request stays queued. Also raises `maxSeenStamp` to the largest stamp pushed, so a
 * clock stepped back after a reload cannot stamp an edit below what this device already sent.
 */
async function settle(
  ctx: Ctx,
  sent: readonly { tbl: string; id: string; at: Millis }[],
  opts: { raiseStamp: boolean },
): Promise<void> {
  if (sent.length === 0) return
  await db.transaction('rw', db.syncOutbox, db.syncState, async () => {
    const state = await db.syncState.get(SYNC_STATE_ID)
    if (!state?.enabled || state.deviceId !== ctx.deviceId) throw new CycleCancelled()
    const current = await db.syncOutbox.bulkGet(sent.map((s): Key => [s.tbl, s.id]))
    const doomed: Key[] = []
    let newest = 0
    sent.forEach((s, i) => {
      if (isSettled(s.at, current[i]?.at)) doomed.push([s.tbl, s.id])
      if (s.at > newest) newest = s.at
    })
    if (doomed.length > 0) await db.syncOutbox.bulkDelete(doomed)
    if (opts.raiseStamp && newest > state.maxSeenStamp) {
      await db.syncState.put({ ...state, maxSeenStamp: newest })
    }
  })
}

/**
 * Sends one batch. A batch the server says is too large, or refuses as content (a 4xx that is not about
 * signing in, access or rate), is halved until the one record at fault is alone; that record is left
 * out and reported, and the queue moves on. Anything else ends the cycle.
 */
async function sendBatch(
  ctx: Ctx,
  rows: readonly PushRow[],
  built: BuiltRows,
  keyed: ReadonlyMap<string, SyncOutboxEntry>,
): Promise<void> {
  const queue: (readonly PushRow[])[] = [rows]
  while (queue.length > 0) {
    const batch = queue.shift()
    if (!batch) break
    try {
      await call(ctx, () => ctx.server.push(batch))
    } catch (error) {
      if (
        error instanceof SyncTransportError &&
        (error.kind === 'tooLarge' || isRowRejection(error.kind, error.status))
      ) {
        const halves = splitBatch(batch)
        if (halves) {
          queue.unshift(halves[0], halves[1])
          continue
        }
        const only = batch[0]
        if (only) {
          await refuse(ctx, only, error.kind === 'tooLarge' ? 'tooLarge' : 'refused', built, keyed)
          if (ctx.refused.length > MAX_REFUSED) throw error
          continue
        }
      }
      throw error
    }
    await settle(
      ctx,
      batch.map((r) => ({ tbl: r.tbl, id: r.id, at: r.updatedAt })),
      { raiseStamp: true },
    )
    ctx.pushed += batch.length
    ctx.report('push', ctx.pushed)
  }
}

/** Leaves one record out of the push for good (until it is edited again) and remembers to say so. */
async function refuse(
  ctx: Ctx,
  row: PushRow,
  reason: RefusedRecord['reason'],
  built: BuiltRows,
  keyed: ReadonlyMap<string, SyncOutboxEntry>,
): Promise<void> {
  const label = recordLabel(row.tbl, built.records.get(rowKey(row.tbl, row.id)) ?? row.data)
  ctx.refused.push({ tbl: row.tbl, id: row.id, reason, label })
  const entry = keyed.get(rowKey(row.tbl, row.id))
  if (entry) await settle(ctx, [entry], { raiseStamp: false })
}

/** Pushes the outbox, 200 entries at a time, until it is empty. Returns once nothing is left to send. */
async function pushOutbox(ctx: Ctx): Promise<void> {
  for (let round = 0; round < MAX_PUSH_ROUNDS; round++) {
    const entries = nextPushEntries(await db.syncOutbox.orderBy('at').limit(PUSH_ENTRY_LIMIT).toArray())
    if (entries.length === 0) return
    const built = await buildRows(ctx.deviceId, entries)
    await settle(ctx, built.dropped, { raiseStamp: false })
    const keyed = new Map(built.items.map((i) => [rowKey(i.row.tbl, i.row.id), i.entry]))
    const { batches, tooLarge } = batchRows(built.items.map((i) => i.row))
    for (const row of tooLarge) await refuse(ctx, row, 'tooLarge', built, keyed)
    if (ctx.refused.length > MAX_REFUSED) {
      throw new SyncTransportError('server', 'Supabase would not take these changes.')
    }
    for (const batch of batches) await sendBatch(ctx, batch, built, keyed)
    await ctx.yieldNow()
  }
}

/**
 * The rows the outbox holds right now, as they would be pushed (200 at most): what the engine's
 * page-hide flush sends with `keepalive` when `fitsKeepalive(rows)`. Changes nothing; the next cycle
 * pushes them again harmlessly (a repeated push of the same stamp is accepted).
 */
export async function pendingPushRows(): Promise<PushRow[]> {
  const state = await getSyncState()
  if (!state?.enabled || state.deviceId === null) return []
  const entries = nextPushEntries(await db.syncOutbox.orderBy('at').limit(PUSH_ENTRY_LIMIT).toArray())
  return (await buildRows(state.deviceId, entries)).items.map((i) => i.row)
}

// ─── Pull and apply ─────────────────────────────────────────────────────────

/** Tombstones that would delete a row this device has: what `needsSafetySnapshot` really counts. */
async function deletionsHere(verdicts: readonly RowVerdict[]): Promise<number> {
  const byTable = new Map<SyncTableName, string[]>()
  for (const v of verdicts) {
    if (v.kind !== 'delete' || !isSyncTable(v.row.tbl)) continue
    const ids = byTable.get(v.row.tbl)
    if (ids) ids.push(v.row.id)
    else byTable.set(v.row.tbl, [v.row.id])
  }
  let count = 0
  for (const [tbl, ids] of byTable) {
    count += (await rowsOf(tbl).bulkGet(ids)).filter((r) => r !== undefined).length
  }
  return count
}

/** A page that deletes 25 or more rows here (an import or restore elsewhere) is preceded by a snapshot. */
async function safetySnapshot(ctx: Ctx, verdicts: readonly RowVerdict[]): Promise<void> {
  if (ctx.snapshotTaken) return
  const tombstones = verdicts.filter((v) => v.kind === 'delete').length
  if (tombstones < SAFETY_SNAPSHOT_DELETIONS) return
  const real = await deletionsHere(verdicts)
  if (!needsSafetySnapshot(Array.from({ length: real }, () => ({ deleted: true })))) return
  ctx.report('snapshot', 0)
  try {
    await takeSnapshot('pre-sync', { now: ctx.now(), appVersion: ctx.version })
  } catch (error) {
    throw snapshotFailure(error)
  }
  ctx.snapshotTaken = true
}

interface PageOutcome {
  applied: number
}

/**
 * Applies one page in ONE transaction over the tables it touches (and `syncOutbox`, `syncState`), marked
 * remote-apply: nothing is queued and no timestamp is re-stamped. The decision per row is
 * `decideApply`; data and the cursor move together, so a crash re-pulls at most this page.
 */
async function applyPage(
  ctx: Ctx,
  verdicts: readonly RowVerdict[],
  progress: PullProgress,
  mode: ApplyMode,
  boot: BootstrapIndex | null,
): Promise<PageOutcome> {
  const actionable = verdicts.filter(
    (v): v is Extract<RowVerdict, { kind: 'put' | 'delete' }> =>
      (v.kind === 'put' || v.kind === 'delete') && isSyncTable(v.row.tbl),
  )
  const names = new Set<SyncTableName>(actionable.map((v) => v.row.tbl as SyncTableName))
  // A page of XP (or the account's settings) may move the level: the level watcher must not celebrate it.
  if (names.has('xpEvents') || names.has('settings')) {
    names.add('xpEvents')
    names.add('settings')
  }
  const hasTrash = names.has('trash')
  if (hasTrash) names.add('resources')
  const scope = [...[...names].map(rowsOf), db.syncOutbox, db.syncState, ...(hasTrash ? [db.files] : [])]

  let applied = 0
  const touched = new Set<TableName>()
  const goalIds = new Set<ID>()

  await db.transaction('rw', scope, async (tx) => {
    markRemoteApply(tx.idbtrans)
    const state = await db.syncState.get(SYNC_STATE_ID)
    if (!state?.enabled || state.deviceId !== ctx.deviceId) throw new CycleCancelled()

    // Read what the decisions need: the local rows and the outbox entries of these keys.
    const keys = actionable.map((v): Key => [v.row.tbl, v.row.id])
    const pendings = await db.syncOutbox.bulkGet(keys)
    const locals = new Map<string, Row | undefined>()
    const byTable = new Map<SyncTableName, string[]>()
    for (const v of actionable) {
      const tbl = v.row.tbl as SyncTableName
      const ids = byTable.get(tbl)
      if (ids) ids.push(v.row.id)
      else byTable.set(tbl, [v.row.id])
    }
    for (const [tbl, ids] of byTable) {
      const found = (await rowsOf(tbl).bulkGet(ids)) as (Row | undefined)[]
      ids.forEach((id, i) => locals.set(rowKey(tbl, id), found[i]))
    }

    const puts = new Map<SyncTableName, Row[]>()
    const deletes = new Map<SyncTableName, string[]>()
    const trashGone: Row[] = []
    const dropPending: Key[] = []
    const settingsFallback = defaultSettings(ctx.now())

    actionable.forEach((v, i) => {
      const tbl = v.row.tbl as SyncTableName
      const key = rowKey(tbl, v.row.id)
      const local = locals.get(key)
      const pending = pendings[i]
      const decision = decideApply({
        mode,
        self: ctx.deviceId,
        tbl,
        remote: { at: v.row.updatedAt, device: v.row.deviceId, deleted: v.kind === 'delete' },
        pending: pending ? { at: pending.at } : null,
        local: local ? { updatedAt: typeof local.updatedAt === 'number' ? local.updatedAt : 0 } : null,
      })
      let after: unknown = local
      // The settings row is never deleted: a tombstone for it can only be left over from a wipe.
      if (decision.apply && !(tbl === 'settings' && v.kind === 'delete')) {
        if (decision.dropPending) dropPending.push([tbl, v.row.id])
        if (v.kind === 'delete') {
          if (local !== undefined) {
            const list = deletes.get(tbl)
            if (list) list.push(v.row.id)
            else deletes.set(tbl, [v.row.id])
            if (tbl === 'trash') trashGone.push(local)
            touched.add(tbl)
            applied += 1
            after = undefined
          }
        } else {
          const next: Row | null =
            tbl === 'settings'
              ? mergeRemoteSettings(local, v.data, settingsFallback)
              : tbl === 'trash'
                ? (keepLocalTrashBlobs(local, v.data) as Row)
                : v.data
          if (next !== null) {
            if (!sameRow(local, next)) {
              const list = puts.get(tbl)
              if (list) list.push(next)
              else puts.set(tbl, [next])
              touched.add(tbl)
              applied += 1
              if (tbl === 'tasks') {
                const goalId = planTaskGoalId(next)
                if (goalId !== null) goalIds.add(goalId)
              }
            }
            after = next
          }
        }
      }
      if (boot) {
        boot.remote.set(key, { at: v.row.updatedAt, device: v.row.deviceId, deleted: v.kind === 'delete' })
        indexRemoteSeedRow(boot.seed, v.row)
        noteIdenticalRow(boot.identical, v, tbl === 'trash' ? markTrashBlobs([after])[0] : after)
      }
    })
    if (boot) {
      // Rows this Forge cannot read are still the account's rows: a first sync must not queue over them.
      for (const v of verdicts) {
        if (v.kind === 'put' || v.kind === 'delete') continue
        boot.remote.set(rowKey(v.row.tbl, v.row.id), {
          at: v.row.updatedAt,
          device: v.row.deviceId,
          deleted: v.row.deleted,
        })
      }
    }

    for (const [tbl, rows] of puts) await rowsOf(tbl).bulkPut(rows)
    for (const [tbl, ids] of deletes) if (tbl !== 'trash') await rowsOf(tbl).bulkDelete(ids)
    if (trashGone.length > 0) await removeTrashRows(trashGone)
    if (dropPending.length > 0) await db.syncOutbox.bulkDelete(dropPending)
    if (touched.has('xpEvents') || touched.has('settings')) await absorbRemoteLevel()

    await db.syncState.put({
      ...state,
      pullCursor: Math.max(state.pullCursor, progress.cursor),
      maxSeenStamp: Math.max(state.maxSeenStamp, progress.maxSeenStamp),
    })
  })

  for (const t of touched) ctx.touched.add(t)
  for (const g of goalIds) ctx.goalIds.add(g)
  return { applied }
}

/** Deletes trash rows a pull removed, first keeping the PDFs a resource still points at (the restore case). */
async function removeTrashRows(rows: readonly Row[]): Promise<void> {
  if (filesInTrash(rows).length > 0) {
    const referenced = new Set<string>(
      ((await db.resources.toArray()) as Resource[]).flatMap((r) => (r.fileId ? [r.fileId] : [])),
    )
    const held = new Set<string>((await db.files.toCollection().primaryKeys()) as string[])
    const rescued = rows
      .flatMap((r) => trashFilesToRescue(r, referenced))
      .filter((f) => typeof f.id === 'string' && !held.has(f.id))
    if (rescued.length > 0) await db.files.bulkPut(rescued as unknown as StoredFile[])
  }
  await db.trash.bulkDelete(rows.map((r) => r.id as string))
}

/**
 * XP that arrived from another device must not play a level-up here: the level it reaches is recorded as
 * already celebrated, in the apply transaction itself (untracked), so no watcher ever sees the gap.
 */
async function absorbRemoteLevel(): Promise<void> {
  const settings = await db.settings.get(SETTINGS_ID)
  if (!settings) return
  const events = (await db.xpEvents.toArray()) as XpEvent[]
  const level = levelFromLifetimeXp(lifetimeXp(events)).level
  const absorb = levelToAbsorb(settings.lastCelebratedLevel, level)
  if (absorb !== null) await db.settings.update(SETTINGS_ID, { lastCelebratedLevel: absorb })
}

/** Pulls pages from `start` until a short page, applying each. Returns where the cursor ended. */
async function pullPages(
  ctx: Ctx,
  start: { cursor: number; maxSeenStamp: Millis },
  mode: ApplyMode,
  boot: BootstrapIndex | null,
): Promise<PullProgress> {
  let progress = startPull(start.cursor, start.maxSeenStamp)
  for (;;) {
    const page = await call(ctx, () => ctx.server.pull(progress.cursor, PULL_PAGE_SIZE))
    const step = advancePull(progress, page, { ceiling: ceilingOf(ctx) })
    if (step.stalled) throw new SyncTransportError('server', SYNC_TEXT.stalled)
    if (step.rows.length > 0) {
      const classified = classifyPage(step.rows, SCHEMA_VERSION, ctx.now())
      if (classified.updateNeeded) {
        // A newer Forge wrote this page: nothing of it is written and the cursor stays.
        throw new SyncTransportError('updateNeeded', SYNC_TEXT.updateNeeded)
      }
      await safetySnapshot(ctx, classified.verdicts)
      const outcome = await applyPage(ctx, classified.verdicts, step.progress, mode, boot)
      // After the page, so every edit from now on is stamped past it (a stamp above the server's cap
      // is not taken: `advancePull` already applied `stampCeiling`).
      if (step.progress.maxSeenStamp > progress.maxSeenStamp) {
        db.syncTracker.observeRemoteStamp(step.progress.maxSeenStamp)
      }
      ctx.pulled += step.rows.length
      ctx.applied += outcome.applied
      ctx.report(mode === 'bootstrap' ? 'merge' : 'pull', ctx.pulled)
    }
    progress = step.progress
    if (step.done) return progress
    await ctx.yieldNow()
  }
}

// ─── First sync ─────────────────────────────────────────────────────────────

/** Local rows that only exist because this device seeded them and the account has them too: deleted here, no tombstones. */
async function removeSeedDuplicates(ctx: Ctx, boot: BootstrapIndex): Promise<void> {
  const starters = new Set(STARTER_REWARDS.map((r) => r.title))
  await db.transaction(
    'rw',
    [db.rewards, db.tasks, db.blocklist, db.syncOutbox, db.syncState],
    async (tx) => {
      markUntracked(tx.idbtrans)
      const state = await db.syncState.get(SYNC_STATE_ID)
      if (!state?.enabled || state.deviceId !== ctx.deviceId) throw new CycleCancelled()
      const [rewards, tasks, blocklist] = await Promise.all([
        db.rewards.toArray(),
        db.tasks.filter((t) => t.source === 'onboarding').toArray(),
        db.blocklist.toArray(),
      ])
      const dups = seedDuplicates({ rewards, tasks, blocklist }, boot.seed, starters)
      const ids = (tbl: string): string[] => dups.filter((d) => d.tbl === tbl).map((d) => d.id)
      await db.rewards.bulkDelete(ids('rewards'))
      await db.tasks.bulkDelete(ids('tasks'))
      await db.blocklist.bulkDelete(ids('blocklist'))
      await db.syncOutbox.bulkDelete(dups.map((d): Key => [d.tbl, d.id]))
    },
  )
}

/** Every local synced row as the first sync sees it. */
async function readLocalStamps(ctx: Ctx): Promise<LocalRowStamp[]> {
  const out: LocalRowStamp[] = []
  for (const tbl of SYNC_TABLES) {
    const rows = (await rowsOf(tbl).toArray()) as { id: string; updatedAt?: unknown }[]
    for (const r of rows) {
      out.push({ tbl, id: r.id, updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0 })
    }
    if (rows.length > 500) await ctx.yieldNow()
  }
  return out
}

/** Queues what this device adds to the account (`planBootstrapQueue`), without touching an entry that appeared meanwhile. */
async function queueLocalRows(ctx: Ctx, boot: BootstrapIndex): Promise<void> {
  const local = await readLocalStamps(ctx)
  const queued = new Set(
    ((await db.syncOutbox.toArray()) as SyncOutboxEntry[]).map((e) => rowKey(e.tbl, e.id)),
  )
  const entries = planBootstrapQueue({
    self: ctx.deviceId,
    local,
    queued,
    remote: boot.remote,
    identical: boot.identical,
  })
  const CHUNK = 1000
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK)
    await db.transaction('rw', db.syncOutbox, db.syncState, async () => {
      const state = await db.syncState.get(SYNC_STATE_ID)
      if (!state?.enabled || state.deviceId !== ctx.deviceId) throw new CycleCancelled()
      const existing = await db.syncOutbox.bulkGet(chunk.map((e): Key => [e.tbl, e.id]))
      const fresh = chunk.filter((_, j) => existing[j] === undefined)
      if (fresh.length > 0) await db.syncOutbox.bulkPut(fresh)
    })
    ctx.report('merge', Math.min(i + CHUNK, entries.length))
    await ctx.yieldNow()
  }
}

/**
 * A device's first sync (PLAN §4.7.5): a merge, never a wipe. Every step is idempotent, so an
 * interruption anywhere restarts from the pull; the snapshot is taken once per device id (the data is
 * half merged by then, and a second snapshot would push the real "before" out of the five kept).
 */
async function bootstrap(ctx: Ctx, state: SyncStateRow): Promise<void> {
  if (state.preSyncFor !== ctx.deviceId) {
    ctx.report('snapshot', 0)
    try {
      await takeSnapshot('pre-sync', { now: ctx.now(), appVersion: ctx.version, skipIfEmpty: true })
    } catch (error) {
      throw snapshotFailure(error)
    }
    await patchState(ctx, { preSyncFor: ctx.deviceId })
  }
  ctx.snapshotTaken = true

  const boot: BootstrapIndex = { remote: new Map(), seed: emptySeedIndex(), identical: new Set() }
  await patchState(ctx, { pullCursor: 0 })
  const end = await pullPages(ctx, { cursor: 0, maxSeenStamp: state.maxSeenStamp }, 'bootstrap', boot)
  await ctx.yieldNow()
  await removeSeedDuplicates(ctx, boot)
  await queueLocalRows(ctx, boot)
  await pushOutbox(ctx)
  await patchState(ctx, {
    phase: 'steady',
    accountUserId: ctx.userId ?? state.accountUserId,
    pullCursor: Math.max(end.cursor, 0),
  })
}

// ─── The cycle ──────────────────────────────────────────────────────────────

function failureOf(error: unknown, at: Millis): Extract<SyncCycleResult, { status: 'error' }> {
  if (error instanceof SyncTransportError) {
    return {
      status: 'error',
      error: { kind: error.kind, message: error.message, at },
      retryAfterMs: error.retryAfterMs,
      httpStatus: error.status,
      ...(error.cause === undefined ? {} : { cause: error.cause }),
    }
  }
  return {
    status: 'error',
    error: { kind: 'server', message: 'Forge hit a problem while syncing. It will try again.', at },
    retryAfterMs: null,
    httpStatus: null,
    cause: error,
  }
}

async function cycle(server: SyncServer, opts: SyncCycleOptions): Promise<SyncCycleResult> {
  const now = opts.now ?? Date.now
  let state = await getSyncState()
  if (!state?.enabled) return { status: 'off' }
  if (state.deviceId === null) {
    // Enabled without an id (a half-written row): start over as a new device.
    state = await writeState((row) => ({ ...row, deviceId: newId(), phase: 'bootstrap', preSyncFor: null }))
  }
  const ctx: Ctx = {
    server,
    opts,
    now,
    deviceId: state.deviceId as string,
    userId: state.session?.userId ?? null,
    version: opts.appVersion ?? appVersion(),
    skew: state.clockSkewMs,
    refreshed: false,
    snapshotTaken: false,
    pushed: 0,
    pulled: 0,
    applied: 0,
    touched: new Set(),
    goalIds: new Set(),
    refused: [],
    yieldNow: opts.yieldNow ?? yieldToMain,
    report: (step, rows) => opts.onProgress?.({ step, rows }),
  }
  const mode: ApplyMode = state.phase === 'steady' ? 'steady' : 'bootstrap'
  try {
    await patchState(ctx, { lastAttemptAt: now() })
    if (!state.session) throw new SyncTransportError('signedOut', SYNC_TEXT.signedOut)
    if (opts.refresh && tokenNeedsRefresh(state.session.expiresAt, now())) await refreshSession(ctx)
    ctx.skew = await measureClock(ctx, state.clockSkewMs)

    if (mode === 'bootstrap') {
      await bootstrap(ctx, state)
    } else {
      await pushOutbox(ctx)
      const fresh = (await getSyncState()) ?? state
      await pullPages(ctx, { cursor: fresh.pullCursor, maxSeenStamp: fresh.maxSeenStamp }, 'steady', null)
    }

    const refusedError: SyncError | null = ctx.refused[0]
      ? {
          kind: ctx.refused[0].reason === 'tooLarge' ? 'tooLarge' : 'server',
          message:
            ctx.refused[0].reason === 'tooLarge'
              ? SYNC_TEXT.tooLarge(ctx.refused[0].label)
              : SYNC_TEXT.refused(ctx.refused[0].label),
          at: now(),
        }
      : null
    await patchState(ctx, {
      lastSyncAt: now(),
      lastError: refusedError,
      clockSkewMs: ctx.skew,
    })
    return {
      status: 'ok',
      mode,
      pushed: ctx.pushed,
      pulled: ctx.pulled,
      applied: ctx.applied,
      refused: ctx.refused,
    }
  } catch (error) {
    if (error instanceof CycleCancelled) return { status: 'off' }
    const failed = failureOf(error, now())
    try {
      await patchState(ctx, {
        lastError: failed.error,
        clockSkewMs: ctx.skew,
        ...(failed.error.kind === 'signedOut' ? { session: null } : {}),
      })
    } catch {
      return { status: 'off' }
    }
    return failed
  } finally {
    if (ctx.applied > 0) {
      emit({ type: 'sync.applied', tables: [...ctx.touched], goalIds: [...ctx.goalIds] })
    }
  }
}

/**
 * One sync cycle against `server`. Never throws: a failure is stored in `syncState.lastError` and returned
 * (`status: 'error'`) for the caller's retry schedule. Only one cycle runs at a time in a page; a second
 * call returns `busy`. The start-up gate (`waitForStartupSync`) opens when the first cycle ends, however
 * it ends.
 */
export async function runSyncCycle(
  server: SyncServer,
  opts: SyncCycleOptions = {},
): Promise<SyncCycleResult> {
  if (running) return { status: 'busy' }
  running = true
  try {
    return await cycle(server, opts)
  } finally {
    running = false
    settleStartupSync()
  }
}

/** Test helper: forget what the engine remembers between cycles (clock checks). */
export function resetSyncEngineForTests(): void {
  clockChecks.clear()
  running = false
}
