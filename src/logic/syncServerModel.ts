/**
 * An in-memory model of the `forge_rows` table and its trigger (PLAN §4.7.3), rule for rule, so the sync
 * engine can be tested with several devices and no network: the repo tests' fake server (12B3) and the
 * Playwright fake Supabase (12B6) are thin wrappers over this. Pure: the server's clock is a parameter.
 *
 * What it mirrors (`public.forge_rows_accept()` and the policies, in the order PostgreSQL runs them for
 * `insert … on conflict (user_id, tbl, id) do update`, which is how the client pushes):
 *  1. before the insert, for every proposed row: the stamp is capped at server time + 5 minutes, then
 *     `seq` is drawn from the one sequence (`nextval`), `modified_at` is set, and a tombstone loses its
 *     `data`;
 *  2. row-level security: the proposed row's `user_id` must be the caller's (`403`, `42501`); the anon
 *     role, which has no grants, gets `401`, `42501`;
 *  3. table constraints: name and id lengths, `schema_version > 0`, `deleted or data is not null`
 *     (`400`, `23514`);
 *  4. if the key exists, the update trigger runs: a stamp older than the stored one, by
 *     `(updated_at, device_id)` with the larger device id winning a tie, is skipped and the stored row
 *     stays (`INSERT 0 0`); an equal stamp from the same device (a retried push) is accepted; an
 *     accepted update draws `seq` a second time, so `seq` has gaps and only its order means anything;
 *  5. two proposed rows for the same key in one statement fail (`400`, `21000`), so a client must never
 *     send a key twice in a batch.
 * A statement is all or nothing (rows written before a failing row are rolled back), but the sequence
 * is not rolled back, as in PostgreSQL. Because a push is atomic here, `seq` order is commit order, the
 * property the per-account advisory lock gives the real table. A pull returns one account's rows in
 * `seq` order (RLS `select`), never another's.
 *
 * Data crosses the boundary as JSON (`JSON.parse(JSON.stringify(…))`), as it does on the wire: an
 * `undefined` field disappears, and a caller can not change a stored row by keeping a reference.
 */
import type { Millis } from '@/db/types'
import {
  classifySyncError,
  clampStamp,
  compareStamps,
  rowKey,
  SyncTransportError,
  type PushRow,
  type ServerRow,
  type SyncServer,
} from './sync'

/** A row as pushed, with the `user_id` the client put in the body (default: the caller's own). */
export interface ModelPushRow extends PushRow {
  userId?: string
}

/** A stored row: the server row plus the columns a client never asks for. */
export interface StoredRow extends ServerRow {
  userId: string
  /** Server time of the last accepted write (`modified_at`), for humans debugging. */
  modifiedAt: Millis
}

/** What one push did, like the command tag: rows added, rows replaced, rows skipped because older. */
export interface PushOutcome {
  inserted: number
  updated: number
  skipped: number
}

function sqlError(status: number, code: string, message: string): SyncTransportError {
  return new SyncTransportError(classifySyncError({ status, code }), message, { status, code })
}

const denied = (): SyncTransportError =>
  sqlError(401, '42501', 'permission denied for table forge_rows')

const charLength = (text: string): number => [...text].length

/** The value as it comes out of a JSON round trip; `undefined` (which JSON cannot carry) becomes null. */
function jsonClone(value: unknown): unknown {
  const text = JSON.stringify(value)
  return text === undefined ? null : (JSON.parse(text) as unknown)
}

function toServerRow(row: StoredRow): ServerRow {
  return {
    tbl: row.tbl,
    id: row.id,
    updatedAt: row.updatedAt,
    deviceId: row.deviceId,
    deleted: row.deleted,
    schemaVersion: row.schemaVersion,
    data: row.data === null ? null : jsonClone(row.data),
    seq: row.seq,
  }
}

export class SyncServerModel {
  private readonly table = new Map<string, StoredRow>()
  private sequence = 0

  /** The last value the sequence handed out (0 before anything was written). */
  get lastSeq(): number {
    return this.sequence
  }

  /** The number of stored rows, tombstones included, over all accounts. */
  get size(): number {
    return this.table.size
  }

  private key(userId: string, tbl: string, id: string): string {
    return `${userId}\u0000${rowKey(tbl, id)}`
  }

  /**
   * `POST /rest/v1/forge_rows?on_conflict=user_id,tbl,id` with `resolution=merge-duplicates`. `userId` is
   * the caller (`auth.uid()`), null for the anon role. Throws `SyncTransportError`; then nothing was
   * stored.
   */
  push(userId: string | null, rows: readonly ModelPushRow[], now: Millis): PushOutcome {
    if (userId === null) throw denied()
    const outcome: PushOutcome = { inserted: 0, updated: 0, skipped: 0 }
    const staged = new Map<string, StoredRow>()
    const affected = new Set<string>()

    for (const proposed of rows) {
      // 1. BEFORE INSERT trigger.
      const updatedAt = clampStamp(proposed.updatedAt, now)
      const seq = ++this.sequence
      const data: unknown = proposed.deleted ? null : jsonClone(proposed.data)
      const owner: string = proposed.userId ?? userId

      // 2. Row-level security, WITH CHECK on the proposed row.
      if (owner !== userId) {
        throw sqlError(
          403,
          '42501',
          'new row violates row-level security policy for table "forge_rows"',
        )
      }

      // 3. Constraints on the proposed row.
      const violation = this.violation(proposed, updatedAt, data)
      if (violation !== null) throw sqlError(400, violation.code, violation.message)

      // 4. Conflict handling.
      const key = this.key(owner, proposed.tbl, proposed.id)
      const existing = staged.get(key) ?? this.table.get(key)
      if (existing === undefined) {
        staged.set(key, {
          tbl: proposed.tbl,
          id: proposed.id,
          updatedAt,
          deviceId: proposed.deviceId,
          deleted: proposed.deleted,
          schemaVersion: proposed.schemaVersion,
          data,
          seq,
          userId: owner,
          modifiedAt: now,
        })
        affected.add(key)
        outcome.inserted += 1
        continue
      }
      // 5. ON CONFLICT DO UPDATE may not touch one row twice in a statement.
      if (affected.has(key)) {
        throw sqlError(
          400,
          '21000',
          'ON CONFLICT DO UPDATE command cannot affect row a second time',
        )
      }
      // BEFORE UPDATE trigger: last write wins, the larger device id wins a tie, an equal stamp is a retry.
      const older =
        compareStamps(
          { at: updatedAt, device: proposed.deviceId },
          { at: existing.updatedAt, device: existing.deviceId },
        ) < 0
      if (older) {
        outcome.skipped += 1
        continue
      }
      staged.set(key, {
        ...existing,
        updatedAt,
        deviceId: proposed.deviceId,
        deleted: proposed.deleted,
        schemaVersion: proposed.schemaVersion,
        data,
        seq: ++this.sequence,
        modifiedAt: now,
      })
      affected.add(key)
      outcome.updated += 1
    }

    for (const [key, row] of staged) this.table.set(key, row)
    return outcome
  }

  /** The first table constraint the proposed row breaks, if any. */
  private violation(
    row: ModelPushRow,
    updatedAt: Millis,
    data: unknown,
  ): { code: string; message: string } | null {
    const check = (message: string) => ({
      code: '23514',
      message: `violates check constraint ${message}`,
    })
    if (!Number.isSafeInteger(updatedAt)) {
      return { code: '22P02', message: 'invalid input syntax for type bigint' }
    }
    const tbl = charLength(row.tbl)
    if (tbl < 1 || tbl > 64) return check('"forge_rows_tbl_check"')
    const id = charLength(row.id)
    if (id < 1 || id > 200) return check('"forge_rows_id_check"')
    const device = charLength(row.deviceId)
    if (device < 1 || device > 64) return check('"forge_rows_device_id_check"')
    if (!Number.isInteger(row.schemaVersion) || row.schemaVersion <= 0) {
      return check('"forge_rows_schema_version_check"')
    }
    if (!row.deleted && data === null) return check('"forge_rows_data_check"')
    return null
  }

  /**
   * `GET /rest/v1/forge_rows?seq=gt.<afterSeq>&order=seq.asc&limit=<limit>`: this account's rows past the
   * cursor, oldest `seq` first.
   */
  pull(userId: string | null, afterSeq: number, limit: number): ServerRow[] {
    if (userId === null) throw denied()
    const rows: StoredRow[] = []
    for (const row of this.table.values()) {
      if (row.userId === userId && row.seq > afterSeq) rows.push(row)
    }
    rows.sort((a, b) => a.seq - b.seq)
    return rows.slice(0, Math.max(0, Math.floor(limit))).map(toServerRow)
  }

  /** `POST /rest/v1/rpc/forge_now`: the server's clock. The anon role may not call it. */
  serverTime(userId: string | null, now: Millis): Millis {
    if (userId === null) throw denied()
    return now
  }

  /** One of this account's rows (a tombstone included), or undefined. */
  get(userId: string, tbl: string, id: string): ServerRow | undefined {
    const row = this.table.get(this.key(userId, tbl, id))
    return row === undefined ? undefined : toServerRow(row)
  }

  /** Every row of one account, tombstones included, in `seq` order. */
  rows(userId: string): ServerRow[] {
    return this.stored(userId).map(toServerRow)
  }

  /** Every row of one account with the server-only columns, in `seq` order. */
  stored(userId: string): StoredRow[] {
    return [...this.table.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => a.seq - b.seq)
      .map((r) => ({ ...r, data: r.data === null ? null : jsonClone(r.data) }))
  }

  /** `delete from public.forge_rows where user_id = auth.uid()`: erases one account's rows. The sequence carries on. */
  erase(userId: string | null): number {
    if (userId === null) throw denied()
    let removed = 0
    for (const [key, row] of this.table) {
      if (row.userId !== userId) continue
      this.table.delete(key)
      removed += 1
    }
    return removed
  }

  /**
   * The model as a `SyncServer` for one account (null: not signed in), reading the server clock from
   * `clock` at every call. Calls reject instead of throwing, as a transport does.
   */
  session(userId: string | null, clock: () => Millis): SyncServer {
    return {
      push: async (rows) => {
        this.push(userId, rows, clock())
      },
      pull: async (afterSeq, limit) => this.pull(userId, afterSeq, limit),
      serverTime: async () => this.serverTime(userId, clock()),
    }
  }
}
