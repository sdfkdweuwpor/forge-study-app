/**
 * Change tracking for cloud sync (PLAN §4.7.4): a Dexie DBCore middleware that, while sync is on, adds
 * one `syncOutbox` entry per synced record a read-write transaction changes, in that same transaction.
 * Deletes are entries too (the push finds the row gone and sends a tombstone), including `clear()` and
 * `where(…).delete()`, which arrive as `deleteRange`.
 *
 * It is always installed (Dexie only builds its middleware stack when the database opens), and with
 * sync off it is a pass-through: `transaction()` does not widen the scope and `mutate()` returns at its
 * first check. The on/off flag is loaded from `syncState` when the database opens (`load`), and other
 * tabs are told about a change, and about remote stamps applied, over a BroadcastChannel (`listen`).
 *
 * Stamps come from the tab's hybrid clock (`stamp.ts`), and an entry's stamp always passes the entry it
 * replaces, even one written by another tab, so the push can compare-and-delete on the stamp alone.
 *
 * Dexie facts this relies on (each guarded by `tracking.test.ts`): the middleware sits above Dexie's
 * hooks (level 10 > 2); `req.trans` is the Dexie transaction's `idbtrans`; a nested transaction reuses
 * its parent's; upgrade transactions are not created through `transaction()`; writes sent `down` pass
 * through the observability layer, so live queries on the outbox update.
 */
import type {
  DBCore,
  DBCoreMutateRequest,
  DBCoreMutateResponse,
  DBCoreTable,
  DBCoreTransaction,
  Dexie,
  Middleware,
} from 'dexie'
import {
  APPEND_ONLY_TABLES,
  isSyncTable,
  syncedSettingsChanged,
  type SyncTableName,
} from '@/logic/syncTables'
import type { Millis, SyncOutboxEntry, SyncStateRow } from '../types'
import { isUntracked } from './remoteApply'
import { StampClock, isStamp } from './stamp'

export const OUTBOX_TABLE = 'syncOutbox'
export const SYNC_STATE_TABLE = 'syncState'
export const SYNC_STATE_ID = 'device'
const CHANNEL_NAME = 'forge:sync'

/** What the tabs tell each other: tracking switched on or off, a newer remote stamp applied. */
type TrackingMessage = { type: 'tracking'; on: boolean } | { type: 'seen'; stamp: Millis }

const readMessage = (v: unknown): TrackingMessage | null => {
  if (typeof v !== 'object' || v === null) return null
  const m = v as { type?: unknown; on?: unknown; stamp?: unknown }
  if (m.type === 'tracking' && typeof m.on === 'boolean') return { type: 'tracking', on: m.on }
  if (m.type === 'seen' && isStamp(m.stamp)) return { type: 'seen', stamp: m.stamp }
  return null
}

const stringKeys = (keys: readonly unknown[]): string[] =>
  keys.filter((k): k is string => typeof k === 'string')

/** The primary keys an add, put or delete touches (every synced table is keyed by a string id). */
function directKeys(
  table: DBCoreTable,
  req: Exclude<DBCoreMutateRequest, { type: 'deleteRange' }>,
): string[] {
  if (req.type === 'delete') return stringKeys(req.keys)
  if (req.keys) return stringKeys(req.keys)
  const extract = table.schema.primaryKey.extractKey
  return stringKeys(req.values.map((v: unknown) => (extract ? extract(v) : undefined)))
}

export class SyncTracker {
  private active = false
  private readonly stamps: StampClock
  private readonly tracked = new WeakSet<DBCoreTransaction>()
  private readonly listeners = new Set<() => void>()
  private channel: BroadcastChannel | null = null

  constructor(clock: () => Millis) {
    this.stamps = new StampClock(clock)
  }

  /** Whether writes are being queued in this tab. */
  get enabled(): boolean {
    return this.active
  }

  /**
   * Switches tracking in this tab; with `broadcast`, in the other open tabs too. Only the sync feature
   * (turning sync on or off) and a reset call this.
   */
  setEnabled(on: boolean, opts: { broadcast?: boolean } = {}): void {
    this.active = on
    if (opts.broadcast)
      this.channel?.postMessage({ type: 'tracking', on } satisfies TrackingMessage)
  }

  /** Makes later stamps larger than these (the newest stamp seen from the server, the outbox's newest). */
  seed(stamps: { maxSeenStamp?: Millis; lastStamp?: Millis }): void {
    this.stamps.seed(stamps)
  }

  /**
   * A remote stamp this device has applied (the sync engine calls it after each pulled page, with the
   * page's newest stamp): later edits here and in the other open tabs get larger stamps, so an edit made
   * after seeing that change beats it. A stamp that is not a finite number is ignored (see `StampClock`).
   */
  observeRemoteStamp(stamp: Millis): void {
    if (!isStamp(stamp)) return
    this.stamps.seed({ maxSeenStamp: stamp })
    this.channel?.postMessage({ type: 'seen', stamp } satisfies TrackingMessage)
  }

  /** The next last-write-wins stamp (strictly increasing in this tab). */
  stamp(): Millis {
    return this.stamps.next()
  }

  /** Called after every tracked write (the engine debounces a sync on it). Returns an unsubscribe. */
  onTrackedWrite(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Reads the flag and the stamp floor from the database. Run on every open (`db.on('ready')`). */
  async load(db: Dexie): Promise<void> {
    const state = (await db.table(SYNC_STATE_TABLE).get(SYNC_STATE_ID)) as SyncStateRow | undefined
    const newest = (await db.table(OUTBOX_TABLE).orderBy('at').last()) as
      SyncOutboxEntry | undefined
    this.seed({ maxSeenStamp: state?.maxSeenStamp ?? 0, lastStamp: newest?.at ?? 0 })
    this.active = state?.enabled === true
  }

  /** Follows tracking changes and remote stamps from other tabs. Call once for the app's database. */
  listen(): void {
    if (this.channel || typeof BroadcastChannel !== 'function') return
    this.channel = new BroadcastChannel(CHANNEL_NAME)
    this.channel.onmessage = (e: MessageEvent<unknown>) => {
      const m = readMessage(e.data)
      if (m?.type === 'tracking') this.active = m.on
      else if (m) this.stamps.seed({ maxSeenStamp: m.stamp })
    }
  }

  /** Stops following other tabs. */
  unlisten(): void {
    this.channel?.close()
    this.channel = null
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn()
      } catch {
        // A listener's failure must never fail the write that triggered it.
      }
    }
  }

  /**
   * Runs `req` and queues its keys. Everything is chained on the promises the lower layers return
   * (Dexie promises): Dexie's own middlewares below read the transaction from Dexie's zone, which a
   * native `await` would lose. Reads that must see the rows before the write are issued before it.
   */
  private trackMutate(
    name: SyncTableName,
    table: DBCoreTable,
    down: DBCore,
    req: DBCoreMutateRequest,
  ): Promise<DBCoreMutateResponse> {
    const outbox = down.table(OUTBOX_TABLE)
    const finish =
      (keys: readonly string[], queue: readonly string[]) =>
      (res: DBCoreMutateResponse): DBCoreMutateResponse | Promise<DBCoreMutateResponse> => {
        // A failed operation in a bulk write changed nothing for its key.
        const failed =
          res.numFailures > 0 && req.type !== 'deleteRange'
            ? new Set(Object.keys(res.failures).map((i) => keys[Number(i)]))
            : null
        const ids = failed ? queue.filter((k) => !failed.has(k)) : queue
        if (ids.length === 0) return res
        // An entry's stamp always passes the one it replaces, even one another tab wrote: the push drops
        // an entry only while its stamp is still the one it sent, so an edit made meanwhile stays queued.
        return outbox
          .getMany({ trans: req.trans, keys: ids.map((id) => [name, id]) })
          .then((before: readonly (SyncOutboxEntry | undefined)[]) => {
            const stamp = this.stamps.next()
            let newest = stamp
            const values = ids.map((id, i): SyncOutboxEntry => {
              const prev = before[i]?.at ?? 0
              const at = prev < stamp ? stamp : prev + 1
              if (at > newest) newest = at
              return { tbl: name, id, at }
            })
            if (newest > stamp) this.stamps.seed({ lastStamp: newest })
            return outbox.mutate({ trans: req.trans, type: 'put', values })
          })
          .then(() => {
            this.notify()
            return res
          })
      }

    if (req.type === 'deleteRange') {
      // clear() and where(…).delete(): read the keys first (the same transaction runs them in order).
      return table
        .query({
          trans: req.trans,
          values: false,
          query: { index: table.schema.primaryKey, range: req.range },
        })
        .then((found) => {
          const keys = stringKeys(found.result)
          return table.mutate(req).then(finish(keys, keys))
        })
    }
    const keys = directKeys(table, req)
    if (keys.length === 0) return table.mutate(req)
    const settings = name === 'settings'
    const needsBefore = req.type !== 'delete' && (settings || APPEND_ONLY_TABLES.has(name))
    if (!needsBefore) return table.mutate(req).then(finish(keys, keys))
    const values = req.values
    return table.getMany({ trans: req.trans, keys }).then((before: unknown[]) => {
      const queue = keys.filter((_, i) =>
        settings
          ? // Only device fields changed (theme, the blocker's cursors…): nothing to sync.
            syncedSettingsChanged(before[i], values[i])
          : // An append-only row written again: not a change.
            before[i] === undefined,
      )
      return table.mutate(req).then(finish(keys, queue))
    })
  }

  readonly middleware: Middleware<DBCore> = {
    stack: 'dbcore',
    name: 'SyncTracking',
    level: 10,
    create: (down) => ({
      ...down,
      transaction: (stores, mode, options) => {
        const track = mode === 'readwrite' && this.active && stores.some(isSyncTable)
        const scope = track && !stores.includes(OUTBOX_TABLE) ? [...stores, OUTBOX_TABLE] : stores
        const trans = down.transaction(scope, mode, options)
        if (track) this.tracked.add(trans)
        return trans
      },
      table: (name) => {
        const table = down.table(name)
        if (!isSyncTable(name)) return table
        return {
          ...table,
          mutate: (req: DBCoreMutateRequest): Promise<DBCoreMutateResponse> =>
            !this.tracked.has(req.trans) || isUntracked(req.trans)
              ? table.mutate(req)
              : this.trackMutate(name, table, down, req),
        }
      },
    }),
  }
}
