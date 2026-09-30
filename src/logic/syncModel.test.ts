/**
 * The server model against the SQL trigger's rules, and the sync rules of `sync.ts` against the model:
 * scenarios with two or three simulated devices, then a seeded property test over random interleavings.
 */
import { describe, expect, it } from 'vitest'
import type { SyncOutboxEntry } from '@/db/types'
import {
  advancePull,
  batchRows,
  decideApply,
  isSettled,
  mergeRemoteSettings,
  newer,
  nextPushEntries,
  noteIdenticalRow,
  planBootstrapQueue,
  prepareRemoteRow,
  rowKey,
  startPull,
  stampCeiling,
  SyncTransportError,
  tickStamp,
  toServerRow,
  type ApplyMode,
  type PushRow,
  type RemoteIndexEntry,
  type RowVerdict,
  type ServerRow,
} from './sync'
import { SyncServerModel, type ModelPushRow } from './syncServerModel'
import { syncedSettings, syncedSettingsChanged, type SyncTableName } from './syncTables'

/** A small seeded PRNG (mulberry32): every failure names its seed and can be replayed. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SCHEMA = 3
const ANA = '5b2f0a3e-9c41-4d7a-8f10-2a6e7b3c9d55'
const BEN = 'c81d44f0-3b7e-4a92-b6d1-0e5f9a2c7b18'
const BASE = 1_800_000_000_000
const MIN = 60_000

const push = (over: Partial<ModelPushRow> = {}): ModelPushRow => ({
  tbl: 'tasks',
  id: 't1',
  updatedAt: BASE,
  deviceId: 'dev-m',
  deleted: false,
  schemaVersion: SCHEMA,
  data: { id: 't1', title: 'C182 · Unit 3' },
  ...over,
})

function failure(fn: () => unknown): SyncTransportError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(SyncTransportError)
    return e as SyncTransportError
  }
  throw new Error('expected the call to throw')
}

// ─── The model against the SQL trigger ──────────────────────────────────────

describe('SyncServerModel: last write wins', () => {
  it('stores a new row with the next seq, and serves rows in seq order after a cursor', () => {
    const m = new SyncServerModel()
    expect(m.push(ANA, [push({ id: 'a' }), push({ id: 'b' }), push({ id: 'c' })], BASE)).toEqual({
      inserted: 3,
      updated: 0,
      skipped: 0,
    })
    const all = m.pull(ANA, 0, 500)
    expect(all.map((r) => [r.id, r.seq])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
    expect(m.pull(ANA, 2, 500).map((r) => r.id)).toEqual(['c'])
    expect(m.pull(ANA, 3, 500)).toEqual([])
    expect(m.pull(ANA, 0, 2).map((r) => r.id)).toEqual(['a', 'b'])
    expect(m.pull(ANA, 0, 0)).toEqual([])
    expect(all[0]).toEqual({
      tbl: 'tasks',
      id: 'a',
      updatedAt: BASE,
      deviceId: 'dev-m',
      deleted: false,
      schemaVersion: SCHEMA,
      data: { id: 't1', title: 'C182 · Unit 3' },
      seq: 1,
    })
  })

  it('skips an older write and keeps the stored row (INSERT 0 0)', () => {
    const m = new SyncServerModel()
    m.push(ANA, [push({ updatedAt: BASE + 10, data: { id: 't1', title: 'new' } })], BASE)
    const before = m.get(ANA, 'tasks', 't1')
    const out = m.push(ANA, [push({ updatedAt: BASE + 9, data: { id: 't1', title: 'old' } })], BASE)
    expect(out).toEqual({ inserted: 0, updated: 0, skipped: 1 })
    expect(m.get(ANA, 'tasks', 't1')).toEqual(before)
  })

  it('accepts a newer write and gives it a larger seq', () => {
    const m = new SyncServerModel()
    m.push(ANA, [push({ updatedAt: BASE })], BASE)
    const first = m.get(ANA, 'tasks', 't1')?.seq ?? 0
    const out = m.push(
      ANA,
      [push({ updatedAt: BASE + 1, data: { id: 't1', title: 'edited' } })],
      BASE,
    )
    expect(out.updated).toBe(1)
    const row = m.get(ANA, 'tasks', 't1')
    expect(row?.seq).toBeGreaterThan(first)
    expect(row?.data).toEqual({ id: 't1', title: 'edited' })
    expect(m.pull(ANA, first, 500)).toHaveLength(1)
  })

  it('breaks a tie on the stamp by the larger device id', () => {
    const m = new SyncServerModel()
    m.push(ANA, [push({ deviceId: 'dev-m', data: { id: 't1', title: 'from m' } })], BASE)
    // A smaller device id with the same stamp loses.
    expect(
      m.push(ANA, [push({ deviceId: 'dev-a', data: { id: 't1', title: 'from a' } })], BASE).skipped,
    ).toBe(1)
    expect(m.get(ANA, 'tasks', 't1')?.deviceId).toBe('dev-m')
    // A larger one wins.
    expect(
      m.push(ANA, [push({ deviceId: 'dev-z', data: { id: 't1', title: 'from z' } })], BASE).updated,
    ).toBe(1)
    expect(m.get(ANA, 'tasks', 't1')).toMatchObject({
      deviceId: 'dev-z',
      data: { title: 'from z' },
    })
  })

  it('accepts the same stamp from the same device again: a retried push is harmless', () => {
    const m = new SyncServerModel()
    m.push(ANA, [push()], BASE)
    const seq1 = m.get(ANA, 'tasks', 't1')?.seq ?? 0
    const out = m.push(ANA, [push()], BASE)
    expect(out).toEqual({ inserted: 0, updated: 1, skipped: 0 })
    expect(m.get(ANA, 'tasks', 't1')?.data).toEqual({ id: 't1', title: 'C182 · Unit 3' })
    expect(m.get(ANA, 'tasks', 't1')?.seq).toBeGreaterThan(seq1) // served again, so an echo, never a loss
  })

  it('draws seq once for an insert and twice for an accepted update, so seq has gaps', () => {
    const m = new SyncServerModel()
    m.push(ANA, [push({ updatedAt: BASE })], BASE)
    expect(m.lastSeq).toBe(1)
    m.push(ANA, [push({ updatedAt: BASE + 1 })], BASE) // insert-trigger draw + update-trigger draw
    expect(m.lastSeq).toBe(3)
    expect(m.get(ANA, 'tasks', 't1')?.seq).toBe(3)
    m.push(ANA, [push({ updatedAt: BASE - 5 })], BASE) // skipped: one draw, nothing stored
    expect(m.lastSeq).toBe(4)
    expect(m.get(ANA, 'tasks', 't1')?.seq).toBe(3)
  })

  it('keeps tombstones, with no data, and lets a later edit bring the row back', () => {
    const m = new SyncServerModel()
    m.push(ANA, [push({ updatedAt: BASE })], BASE)
    m.push(
      ANA,
      [push({ updatedAt: BASE + 5, deleted: true, data: { id: 't1', leak: 'should be dropped' } })],
      BASE,
    )
    expect(m.get(ANA, 'tasks', 't1')).toMatchObject({ deleted: true, data: null })
    // An edit made earlier than the delete does not resurrect it; a later one does.
    expect(m.push(ANA, [push({ updatedAt: BASE + 4 })], BASE).skipped).toBe(1)
    expect(m.push(ANA, [push({ updatedAt: BASE + 6 })], BASE).updated).toBe(1)
    expect(m.get(ANA, 'tasks', 't1')).toMatchObject({ deleted: false, data: { id: 't1' } })
  })
})

describe('SyncServerModel: the clock cap', () => {
  it('caps a stamp at server time plus five minutes', () => {
    const m = new SyncServerModel()
    m.push(ANA, [push({ id: 'far', updatedAt: BASE + 2 * 3_600_000 })], BASE)
    m.push(ANA, [push({ id: 'edge', updatedAt: BASE + 5 * MIN })], BASE)
    m.push(ANA, [push({ id: 'ok', updatedAt: BASE + 4 * MIN })], BASE)
    expect(m.get(ANA, 'tasks', 'far')?.updatedAt).toBe(BASE + 5 * MIN)
    expect(m.get(ANA, 'tasks', 'edge')?.updatedAt).toBe(BASE + 5 * MIN)
    expect(m.get(ANA, 'tasks', 'ok')?.updatedAt).toBe(BASE + 4 * MIN)
  })

  it('lets a later edit from a normal clock beat a write from a clock that runs far ahead', () => {
    const m = new SyncServerModel()
    m.push(
      ANA,
      [
        push({
          deviceId: 'dev-z',
          updatedAt: BASE + 3_600_000,
          data: { id: 't1', title: 'from 2030' },
        }),
      ],
      BASE,
    )
    const stored = m.get(ANA, 'tasks', 't1')
    expect(stored?.updatedAt).toBe(BASE + 5 * MIN)
    // Six minutes later a device with a right clock edits: its stamp is past the cap.
    const later = BASE + 6 * MIN
    const out = m.push(
      ANA,
      [push({ deviceId: 'dev-a', updatedAt: later, data: { id: 't1', title: 'fixed' } })],
      later,
    )
    expect(out.updated).toBe(1)
    expect(m.get(ANA, 'tasks', 't1')?.data).toEqual({ id: 't1', title: 'fixed' })
  })

  it('at the cap, in the same millisecond, an edit made after seeing the row only ties; a millisecond later it wins', () => {
    // A device with a clock hours ahead: its tombstone is stored at the cap. A device that pulled it stamps
    // its edit one past what it saw. If the server's clock has not moved on since (two requests within one
    // millisecond, which a real network never gives, and a test with a frozen clock does), that stamp is
    // capped back to the tie and the larger device id wins. Fake servers built on this model must move
    // their clock by at least a millisecond between calls.
    const m = new SyncServerModel()
    m.push(
      ANA,
      [push({ deviceId: 'dev-z', deleted: true, data: null, updatedAt: BASE + 3_600_000 })],
      BASE,
    )
    const seen = m.get(ANA, 'tasks', 't1')?.updatedAt ?? 0
    expect(seen).toBe(BASE + 5 * MIN)
    const edit = push({ deviceId: 'dev-a', updatedAt: seen + 1 })
    expect(m.push(ANA, [edit], BASE).skipped).toBe(1)
    expect(m.push(ANA, [edit], BASE + 1).updated).toBe(1)
    expect(m.get(ANA, 'tasks', 't1')?.deleted).toBe(false)
  })

  it('uses the server clock of each call, not the stamps it has seen', () => {
    const m = new SyncServerModel()
    m.push(ANA, [push({ updatedAt: BASE + 10 * MIN })], BASE + 8 * MIN)
    expect(m.get(ANA, 'tasks', 't1')?.updatedAt).toBe(BASE + 10 * MIN) // 8 + 5 = 13 minutes of room
    expect(m.serverTime(ANA, BASE + 12345)).toBe(BASE + 12345)
  })
})

describe('SyncServerModel: row-level security and constraints', () => {
  it('gives each account its own rows, even for the same table and id', () => {
    const m = new SyncServerModel()
    m.push(ANA, [push({ data: { id: 't1', title: "Ana's" } })], BASE)
    m.push(BEN, [push({ data: { id: 't1', title: "Ben's" } })], BASE)
    expect(m.get(ANA, 'tasks', 't1')?.data).toEqual({ id: 't1', title: "Ana's" })
    expect(m.get(BEN, 'tasks', 't1')?.data).toEqual({ id: 't1', title: "Ben's" })
    expect(m.pull(ANA, 0, 500)).toHaveLength(1)
    expect(m.pull(BEN, 0, 500)).toHaveLength(1)
    expect(m.pull('someone-else', 0, 500)).toEqual([])
    expect(m.rows(ANA)).toHaveLength(1)
    expect(m.size).toBe(2)
  })

  it('refuses to insert or update into another account, and stores nothing of the statement', () => {
    const m = new SyncServerModel()
    m.push(ANA, [push()], BASE)
    const before = m.rows(ANA)
    const err = failure(() =>
      m.push(
        BEN,
        [
          push({ id: 'mine' }),
          push({ userId: ANA, updatedAt: BASE + 99, data: { id: 't1', title: 'hijack' } }),
        ],
        BASE,
      ),
    )
    expect(err).toMatchObject({ kind: 'forbidden', status: 403, code: '42501' })
    expect(m.rows(ANA)).toEqual(before)
    expect(m.get(BEN, 'tasks', 'mine')).toBeUndefined() // rolled back with the rest of the statement
    expect(m.push(ANA, [push({ id: 'own', userId: ANA })], BASE).inserted).toBe(1)
  })

  it('answers the anon role, which has no grants, with 401', () => {
    const m = new SyncServerModel()
    m.push(ANA, [push()], BASE)
    for (const call of [
      () => m.push(null, [push()], BASE),
      () => m.pull(null, 0, 500),
      () => m.serverTime(null, BASE),
      () => m.erase(null),
    ]) {
      expect(failure(call)).toMatchObject({ kind: 'signedOut', status: 401, code: '42501' })
    }
    expect(m.rows(ANA)).toHaveLength(1)
  })

  it('refuses rows that break a table constraint: a live row without data, bad sizes, version 0', () => {
    const m = new SyncServerModel()
    const bad: [string, Partial<ModelPushRow>][] = [
      ['live row, no data', { data: undefined }],
      ['live row, null data', { data: null }],
      ['empty id', { id: '' }],
      ['id over 200', { id: 'x'.repeat(201) }],
      ['empty device', { deviceId: '' }],
      ['device over 64', { deviceId: 'd'.repeat(65) }],
      ['schema version 0', { schemaVersion: 0 }],
      ['schema version 1.5', { schemaVersion: 1.5 }],
      ['stamp with a fraction', { updatedAt: BASE + 0.5 }],
    ]
    for (const [name, over] of bad) {
      const err = failure(() => m.push(ANA, [push({ id: 'fine' }), push(over)], BASE))
      expect(err.status, name).toBe(400)
      expect(m.rows(ANA), name).toEqual([]) // "fine" was rolled back
    }
    // A tombstone needs no data, and the length limits are inclusive.
    expect(
      m.push(
        ANA,
        [
          push({ deleted: true, data: null }),
          push({ id: 'x'.repeat(200), deviceId: 'd'.repeat(64) }),
        ],
        BASE,
      ).inserted,
    ).toBe(2)
  })

  it('rejects the same key twice in one statement, as ON CONFLICT DO UPDATE does', () => {
    const m = new SyncServerModel()
    const err = failure(() =>
      m.push(ANA, [push({ updatedAt: BASE }), push({ updatedAt: BASE + 1 })], BASE),
    )
    expect(err).toMatchObject({ status: 400, code: '21000' })
    expect(m.rows(ANA)).toEqual([])
    // The same id in two tables, or for two accounts, is two rows.
    expect(m.push(ANA, [push(), push({ tbl: 'goals' })], BASE).inserted).toBe(2)
  })

  it('does not roll the sequence back when a statement fails, as PostgreSQL does not', () => {
    const m = new SyncServerModel()
    failure(() => m.push(ANA, [push({ id: 'a' }), push({ id: '' })], BASE))
    expect(m.lastSeq).toBe(2)
    m.push(ANA, [push({ id: 'b' })], BASE)
    expect(m.get(ANA, 'tasks', 'b')?.seq).toBe(3)
  })

  it('erases one account only, and keeps counting seq', () => {
    const m = new SyncServerModel()
    m.push(ANA, [push({ id: 'a' }), push({ id: 'b' })], BASE)
    m.push(BEN, [push({ id: 'a' })], BASE)
    expect(m.erase(ANA)).toBe(2)
    expect(m.rows(ANA)).toEqual([])
    expect(m.rows(BEN)).toHaveLength(1)
    m.push(ANA, [push({ id: 'again' })], BASE)
    expect(m.get(ANA, 'tasks', 'again')?.seq).toBe(4)
  })
})

describe('SyncServerModel: the JSON boundary', () => {
  it('stores what JSON would carry, and never shares a reference with a caller', () => {
    const m = new SyncServerModel()
    const data = { id: 't1', title: 'x', gone: undefined, nested: { list: [1, 2] } }
    m.push(ANA, [push({ data })], BASE)
    data.nested.list.push(3)
    data.title = 'mutated'
    const stored = m.get(ANA, 'tasks', 't1')
    expect(stored?.data).toEqual({ id: 't1', title: 'x', nested: { list: [1, 2] } })
    expect('gone' in (stored?.data as object)).toBe(false)
    const pulled = m.pull(ANA, 0, 10)[0]
    ;(pulled?.data as { title: string }).title = 'changed by the caller'
    expect((m.get(ANA, 'tasks', 't1')?.data as { title: string }).title).toBe('x')
    expect(m.stored(ANA)[0]).toMatchObject({ userId: ANA, modifiedAt: BASE })
  })

  it("serves an account's rows through the SyncServer interface, rejecting as a transport does", async () => {
    const m = new SyncServerModel()
    let clock = BASE
    const server = m.session(ANA, () => clock)
    await server.push([push()])
    clock += 30_000
    expect(await server.serverTime()).toBe(BASE + 30_000)
    expect((await server.pull(0, 500)).map((r) => r.id)).toEqual(['t1'])
    const anon = m.session(null, () => clock)
    await expect(anon.pull(0, 500)).rejects.toMatchObject({ kind: 'signedOut' })
    await expect(anon.push([push()])).rejects.toBeInstanceOf(SyncTransportError)
    await expect(anon.serverTime()).rejects.toMatchObject({ status: 401 })
  })
})

// ─── Simulated devices ──────────────────────────────────────────────────────

type Row = Record<string, unknown>

interface Write {
  at: number
  deleted: boolean
  v: string | null
}

/** True time, one account's server, and every write any device made (for the oracle). */
class World {
  now = BASE
  readonly model = new SyncServerModel()
  readonly devices: SimDevice[] = []
  /** key → device → that device's last write to it (program order). */
  readonly writes = new Map<string, Map<string, Write>>()
  pageSize = 500

  constructor(readonly rand: () => number) {}

  add(id: string, offset = 0, steady = true): SimDevice {
    const d = new SimDevice(id, offset, this, steady)
    this.devices.push(d)
    return d
  }

  record(key: string, device: string, w: Write): void {
    const byDevice = this.writes.get(key) ?? new Map<string, Write>()
    byDevice.set(device, w)
    this.writes.set(key, byDevice)
  }
}

const settingsRow = (name: string, theme: string, updatedAt: number): Row => ({
  id: 'app',
  createdAt: 0,
  updatedAt,
  profile: { name },
  onboardedAt: null,
  appearance: { theme, accent: 'teal', reducedMotion: 'system' },
  notifications: { enabled: false, promptedAt: null },
  blocker: { mode: 'focus', extensionIdOverride: null, lastSyncedAt: null, eventsCursor: 0 },
  backup: { lastExportAt: null, lastRemindedAt: null },
})

const updatedAtOf = (row: Row): number => (typeof row.updatedAt === 'number' ? row.updatedAt : 0)

interface PullResult {
  seen: Map<string, RemoteIndexEntry>
  identical: Set<string>
}

/**
 * One device's replica and its sync state, using the pure rules only: the outbox, the hybrid clock, the
 * cursor. `steady = false` is a device that has not joined yet: it writes without tracking, and joins
 * with the first-sync rules.
 */
class SimDevice {
  readonly rows = new Map<string, Row>()
  readonly pending = new Map<string, SyncOutboxEntry>()
  cursor = 0
  maxSeen = 0
  last = 0
  counter = 0
  theme: string

  constructor(
    readonly id: string,
    readonly offset: number,
    readonly world: World,
    public steady: boolean,
  ) {
    this.theme = `theme-of-${id}`
    this.rows.set(rowKey('settings', 'app'), settingsRow('default', this.theme, 0))
  }

  private time(): number {
    return this.world.now + this.offset
  }

  private tick(): number {
    const t = tickStamp({ last: this.last, maxSeen: this.maxSeen }, this.time())
    this.last = t.at
    return t.at
  }

  /** Writes a row: a new value for the key, tracked when the device has joined. */
  edit(tbl: SyncTableName, id: string): void {
    const key = rowKey(tbl, id)
    const v = `${this.id}:${this.counter++}`
    if (tbl === 'settings') {
      if (!this.steady) return
      const at = this.tick()
      const row = settingsRow(v, this.theme, at)
      this.rows.set(key, row)
      this.pending.set(key, { tbl, id, at })
      this.world.record(key, this.id, { at, deleted: false, v })
      return
    }
    if (this.steady) {
      const at = this.tick()
      this.rows.set(key, { id, v, updatedAt: at })
      this.pending.set(key, { tbl, id, at })
      this.world.record(key, this.id, { at, deleted: false, v })
    } else {
      const at = this.time()
      this.rows.set(key, { id, v, updatedAt: at })
      this.world.record(key, this.id, { at, deleted: false, v })
    }
  }

  remove(tbl: SyncTableName, id: string): void {
    const key = rowKey(tbl, id)
    if (!this.steady || !this.rows.has(key)) return
    this.rows.delete(key)
    const at = this.tick()
    this.pending.set(key, { tbl, id, at })
    this.world.record(key, this.id, { at, deleted: true, v: null })
  }

  /** A change to the device-only part of the settings row: never queued. */
  changeAppearance(theme: string): void {
    const key = rowKey('settings', 'app')
    const before = this.rows.get(key)
    if (before === undefined) return
    const after: Row = { ...before, appearance: { theme, accent: 'rose', reducedMotion: 'reduce' } }
    expect(syncedSettingsChanged(before, after)).toBe(false)
    this.rows.set(key, after)
    this.theme = theme
  }

  /** Applies or skips one pulled row; returns the row's verdict, to tell a first sync what is identical. */
  private applyRow(row: ServerRow, mode: ApplyMode): RowVerdict {
    const key = rowKey(row.tbl, row.id)
    const local = this.rows.get(key)
    const pending = this.pending.get(key)
    const d = decideApply({
      mode,
      self: this.id,
      tbl: row.tbl,
      remote: { at: row.updatedAt, device: row.deviceId, deleted: row.deleted },
      pending: pending === undefined ? null : { at: pending.at },
      local: local === undefined ? null : { updatedAt: updatedAtOf(local) },
    })
    const verdict = prepareRemoteRow(row, SCHEMA, this.world.now)
    if (!d.apply) return verdict
    if (d.dropPending) this.pending.delete(key)
    if (verdict.kind === 'delete') this.rows.delete(key)
    else if (verdict.kind === 'put') {
      const written =
        row.tbl === 'settings' ? mergeRemoteSettings(local, verdict.data) : verdict.data
      if (written === null) throw new Error('settings row did not merge')
      this.rows.set(key, written)
    } else throw new Error(`unexpected verdict ${verdict.kind}`)
    return verdict
  }

  /**
   * Pull up to `maxPages` pages (default: to the end), applying each page and moving the cursor with it.
   * Returns what a first sync indexes on the way: every row seen, and which local rows equal the account's.
   */
  pull(maxPages = Number.POSITIVE_INFINITY, mode: ApplyMode = 'steady'): PullResult {
    const seen = new Map<string, RemoteIndexEntry>()
    const identical = new Set<string>()
    if (!this.steady && mode === 'steady') return { seen, identical } // a device that has not joined does not sync
    const limit = this.world.pageSize
    let progress = startPull(mode === 'bootstrap' ? 0 : this.cursor, this.maxSeen)
    for (let page = 0; page < maxPages; page += 1) {
      const rows = this.world.model.pull(ANA, progress.cursor, limit)
      const step = advancePull(progress, rows, { limit, ceiling: stampCeiling(this.world.now) })
      for (const row of step.rows) {
        seen.set(rowKey(row.tbl, row.id), {
          at: row.updatedAt,
          device: row.deviceId,
          deleted: row.deleted,
        })
        const verdict = this.applyRow(row, mode)
        noteIdenticalRow(identical, verdict, this.rows.get(rowKey(row.tbl, row.id)))
      }
      progress = step.progress
      this.cursor = progress.cursor
      this.maxSeen = progress.maxSeenStamp
      if (step.done || step.stalled) break
    }
    return { seen, identical }
  }

  /** The first sync: pull everything with the first-sync rules, queue what this device adds, go steady. */
  join(): void {
    if (this.steady) return
    const { seen: remote, identical } = this.pull(Number.POSITIVE_INFINITY, 'bootstrap')
    const local = [...this.rows.entries()].map(([key, row]) => {
      const at = key.indexOf(':')
      return {
        tbl: key.slice(0, at) as SyncTableName,
        id: key.slice(at + 1),
        updatedAt: updatedAtOf(row),
      }
    })
    const queue = planBootstrapQueue({
      self: this.id,
      local,
      queued: new Set(this.pending.keys()),
      remote,
      identical,
    })
    for (const e of queue) this.pending.set(rowKey(e.tbl, e.id), e)
    this.steady = true
  }

  /**
   * Push up to `count` entries in batches of at most `maxBytes`. With `crash`, the device may lose the
   * answer after the server committed a batch: it never removes those entries and stops.
   */
  push(count = Number.POSITIVE_INFINITY, maxBytes?: number, crash = false): void {
    if (!this.steady) return
    const entries = nextPushEntries([...this.pending.values()], count)
    const byRow = new Map<PushRow, SyncOutboxEntry>()
    for (const e of entries) {
      const key = rowKey(e.tbl, e.id)
      const d = toServerRow(e, this.rows.get(key), { deviceId: this.id, schemaVersion: SCHEMA })
      if (d.kind === 'drop') this.pending.delete(key)
      else byRow.set(d.row, e)
    }
    const { batches, tooLarge } = batchRows(
      [...byRow.keys()],
      maxBytes === undefined ? {} : { maxBytes },
    )
    expect(tooLarge).toEqual([])
    for (const batch of batches) {
      this.world.model.push(ANA, batch, this.world.now)
      if (crash && this.world.rand() < 0.5) return
      for (const row of batch) {
        const entry = byRow.get(row)
        if (entry === undefined) continue
        const key = rowKey(entry.tbl, entry.id)
        if (isSettled(entry.at, this.pending.get(key)?.at)) this.pending.delete(key)
      }
    }
  }

  /** Push everything, pull everything. */
  sync(): void {
    for (let i = 0; i < 4 && this.pending.size > 0; i += 1) this.push()
    this.pull()
  }

  value(tbl: SyncTableName, id: string): unknown {
    return this.rows.get(rowKey(tbl, id))?.v
  }
}

// ─── Scenarios ──────────────────────────────────────────────────────────────

describe('two devices', () => {
  it('a change reaches the other device once, and comes back as an echo that changes nothing', () => {
    const w = new World(prng(1))
    const a = w.add('dev-a')
    const b = w.add('dev-b')
    a.edit('tasks', 't1')
    a.push()
    b.pull()
    expect(b.value('tasks', 't1')).toBe('dev-a:0')
    a.pull() // its own row comes back
    expect(a.value('tasks', 't1')).toBe('dev-a:0')
    expect(a.pending.size).toBe(0)
  })

  it('both offline edit the same record: the later stamp wins on both', () => {
    const w = new World(prng(2))
    const a = w.add('dev-a')
    const b = w.add('dev-b')
    a.edit('tasks', 't1')
    w.now += 5
    b.edit('tasks', 't1') // later
    a.push()
    b.push()
    a.sync()
    b.sync()
    expect(a.value('tasks', 't1')).toBe('dev-b:0')
    expect(b.value('tasks', 't1')).toBe('dev-b:0')
    expect(w.model.get(ANA, 'tasks', 't1')?.deviceId).toBe('dev-b')
  })

  it('when both stamps are equal the larger device id wins, on both', () => {
    const w = new World(prng(3))
    const a = w.add('dev-a')
    const b = w.add('dev-b')
    a.edit('tasks', 't1')
    b.edit('tasks', 't1') // same instant, same clock
    b.push()
    a.push() // skipped by the server
    a.sync()
    b.sync()
    expect(a.value('tasks', 't1')).toBe('dev-b:0')
    expect(b.value('tasks', 't1')).toBe('dev-b:0')
  })

  it('an edit made after seeing a change beats it although this clock is behind', () => {
    const w = new World(prng(4))
    const a = w.add('dev-z', 10 * MIN) // clock 10 minutes ahead
    const b = w.add('dev-a', 0)
    a.edit('tasks', 't1')
    a.push()
    b.pull()
    w.now += 1
    b.edit('tasks', 't1')
    b.push()
    a.sync()
    b.sync()
    expect(a.value('tasks', 't1')).toBe('dev-a:0')
    expect(b.value('tasks', 't1')).toBe('dev-a:0')
  })

  it('a delete made later than an edit wins; an edit made later than a delete brings the row back', () => {
    for (const editLater of [false, true]) {
      const w = new World(prng(5))
      const a = w.add('dev-a')
      const b = w.add('dev-b')
      a.edit('tasks', 't1')
      a.push()
      b.pull()
      if (editLater) {
        a.remove('tasks', 't1')
        w.now += 5
        b.edit('tasks', 't1')
      } else {
        b.edit('tasks', 't1')
        w.now += 5
        a.remove('tasks', 't1')
      }
      a.sync()
      b.sync()
      a.sync()
      if (editLater) {
        expect(a.value('tasks', 't1')).toBe('dev-b:0')
        expect(b.value('tasks', 't1')).toBe('dev-b:0')
      } else {
        expect(a.rows.has(rowKey('tasks', 't1'))).toBe(false)
        expect(b.rows.has(rowKey('tasks', 't1'))).toBe(false)
        expect(w.model.get(ANA, 'tasks', 't1')?.deleted).toBe(true)
      }
    }
  })

  it('a push cut off after the server committed is harmless when the device sends it again', () => {
    const w = new World(prng(6))
    const a = w.add('dev-a')
    const b = w.add('dev-b')
    a.edit('tasks', 't1')
    a.edit('tasks', 't2')
    w.model.push(ANA, [toRow(a, 'tasks', 't1'), toRow(a, 'tasks', 't2')], w.now) // committed, answer lost
    expect(a.pending.size).toBe(2)
    a.sync() // pushes both again
    b.sync()
    expect(a.pending.size).toBe(0)
    expect(b.value('tasks', 't1')).toBe('dev-a:0')
    expect(b.value('tasks', 't2')).toBe('dev-a:1')
    expect(w.model.rows(ANA)).toHaveLength(2)
  })

  it('an edit made while a push is in flight stays queued', () => {
    const w = new World(prng(7))
    const a = w.add('dev-a')
    a.edit('tasks', 't1')
    const entry = a.pending.get(rowKey('tasks', 't1'))
    w.model.push(ANA, [toRow(a, 'tasks', 't1')], w.now)
    w.now += 3
    a.edit('tasks', 't1') // during the request
    expect(isSettled(entry?.at ?? 0, a.pending.get(rowKey('tasks', 't1'))?.at)).toBe(false)
    a.sync()
    expect(w.model.get(ANA, 'tasks', 't1')?.data).toMatchObject({ v: 'dev-a:1' })
  })

  it('pulls page by page, with the cursor moving one page at a time', () => {
    const w = new World(prng(8))
    const a = w.add('dev-a')
    const b = w.add('dev-b')
    for (let i = 0; i < 7; i += 1) {
      a.edit('tasks', `t${i}`)
      w.now += 1
    }
    a.push()
    w.pageSize = 3
    b.pull(1)
    expect(b.rows.size).toBe(1 + 3) // settings + one page
    b.pull(1)
    expect(b.rows.size).toBe(1 + 6)
    b.pull()
    expect(b.rows.size).toBe(1 + 7)
    expect(b.cursor).toBe(w.model.lastSeq)
  })

  it('a far-future clock is capped by the server, and every device still ends on the same row', () => {
    // Two devices, both clocks two hours ahead, writing in the same millisecond: the server stores b's
    // row at the cap. a's own stamp is higher, so a skips b's row while its write is pending; its push is
    // capped at the server's later time + 5 min, which is above b's stored stamp, so it wins everywhere.
    const w = new World(prng(9))
    const a = w.add('dev-a', 2 * 3_600_000)
    const b = w.add('dev-b', 2 * 3_600_000)
    b.edit('tasks', 't1')
    b.push()
    a.edit('tasks', 't1')
    a.pull() // sees b's capped row while its own write is pending
    expect(a.value('tasks', 't1')).toBe('dev-a:0')
    w.now += 1 // a request takes a millisecond
    a.push()
    a.sync()
    b.sync()
    expect(w.model.get(ANA, 'tasks', 't1')?.updatedAt).toBe(w.now + 5 * MIN)
    expect(w.model.get(ANA, 'tasks', 't1')?.deviceId).toBe('dev-a')
    expect(a.value('tasks', 't1')).toBe('dev-a:0')
    expect(b.value('tasks', 't1')).toBe('dev-a:0')
  })
})

function toRow(d: SimDevice, tbl: SyncTableName, id: string): PushRow {
  const entry = d.pending.get(rowKey(tbl, id))
  if (entry === undefined) throw new Error('no entry')
  const decision = toServerRow(entry, d.rows.get(rowKey(tbl, id)), {
    deviceId: d.id,
    schemaVersion: SCHEMA,
  })
  if (decision.kind !== 'push') throw new Error('not pushed')
  return decision.row
}

describe('settings across devices', () => {
  it('a synced field travels, the device-only fields stay, and a device-only change is never queued', () => {
    const w = new World(prng(10))
    const a = w.add('dev-a')
    const b = w.add('dev-b')
    a.changeAppearance('dark')
    expect(a.pending.size).toBe(0)
    a.edit('settings', 'app')
    a.push()
    b.changeAppearance('light')
    b.pull()
    const row = b.rows.get(rowKey('settings', 'app')) as Row
    expect((row.profile as Row).name).toBe('dev-a:0')
    expect((row.appearance as Row).theme).toBe('light')
    expect(b.pending.size).toBe(0)
    const stored = w.model.get(ANA, 'settings', 'app')?.data as Row
    expect('appearance' in stored).toBe(false)
    expect('notifications' in stored).toBe(false)
    expect(syncedSettings(row)).toEqual(syncedSettings(a.rows.get(rowKey('settings', 'app'))))
  })
})

describe('a device joining an account', () => {
  it("adds what only it has, adopts the account's settings, and keeps a newer local row", () => {
    const w = new World(prng(11))
    const a = w.add('dev-a')
    a.edit('tasks', 'shared')
    a.edit('tasks', 'only-a')
    a.edit('settings', 'app')
    w.now += 1_000
    const late = w.add('dev-b', 0, false)
    late.edit('tasks', 'only-b')
    w.now += 1_000
    a.push()
    w.now += 1_000
    late.edit('tasks', 'shared') // newer than a's copy
    late.join()
    late.push()
    a.sync()
    late.sync()
    expect(a.value('tasks', 'only-b')).toBe('dev-b:0')
    expect(late.value('tasks', 'only-a')).toBe('dev-a:1')
    expect(a.value('tasks', 'shared')).toBe('dev-b:1')
    expect(late.value('tasks', 'shared')).toBe('dev-b:1')
    expect(((late.rows.get(rowKey('settings', 'app')) as Row).profile as Row).name).toBe('dev-a:2')
    expect((late.rows.get(rowKey('settings', 'app')) as Row).appearance).toMatchObject({
      theme: 'theme-of-dev-b',
    })
  })

  it('an older local copy does not overwrite the account, and a newer delete removes an older local row', () => {
    const w = new World(prng(12))
    const a = w.add('dev-a')
    const late = w.add('dev-b', 0, false)
    late.edit('tasks', 'stale') // early
    late.edit('tasks', 'deleted-later')
    w.now += 1_000
    a.edit('tasks', 'stale')
    a.edit('tasks', 'deleted-later')
    a.push()
    w.now += 1_000
    a.remove('tasks', 'deleted-later')
    a.push()
    late.join()
    late.push()
    a.sync()
    late.sync()
    expect(late.value('tasks', 'stale')).toBe('dev-a:0')
    expect(late.rows.has(rowKey('tasks', 'deleted-later'))).toBe(false)
    expect(a.value('tasks', 'stale')).toBe('dev-a:0')
    expect(w.model.get(ANA, 'tasks', 'deleted-later')?.deleted).toBe(true)
  })

  it("a row adopted from the account is not sent back, so the joiner's own delete of it wins", () => {
    // Z's clock runs 20 minutes ahead: the server stores its row at server time + 5 min, but the row itself
    // says updatedAt = +20 min. J adopts it. Queued again at that updatedAt, the server would cap the copy
    // at its own (later) time + 5 min: above anything J's clock has seen, so J's delete would lose to it.
    const w = new World(prng(14))
    const z = w.add('dev-z', 20 * MIN)
    const late = w.add('dev-j', 0, false)
    z.edit('tasks', 't0')
    z.edit('settings', 'app') // so the account has settings, which a joiner would otherwise queue
    z.push()
    w.now += 100
    late.join()
    expect(late.value('tasks', 't0')).toBe('dev-z:0')
    expect(late.pending.size).toBe(0)
    w.now += 100
    late.push() // nothing to send
    expect(w.model.get(ANA, 'tasks', 't0')?.deviceId).toBe('dev-z')
    w.now += 100
    late.remove('tasks', 't0')
    late.push()
    z.sync()
    late.sync()
    z.sync()
    expect(w.model.get(ANA, 'tasks', 't0')?.deleted).toBe(true)
    expect(z.rows.has(rowKey('tasks', 't0'))).toBe(false)
    expect(late.rows.has(rowKey('tasks', 't0'))).toBe(false)
  })

  it('a first sync that is interrupted and starts again queues the adopted rows no more than the first run did', () => {
    const w = new World(prng(15))
    const z = w.add('dev-z', 20 * MIN)
    const late = w.add('dev-j', 0, false)
    z.edit('tasks', 't0')
    z.edit('tasks', 't1')
    z.push()
    late.edit('tasks', 'only-j')
    w.now += 100
    late.pull(Number.POSITIVE_INFINITY, 'bootstrap') // run 1: pulled and adopted, then the app closed
    w.now += 100
    late.join() // run 2
    // The account has no settings row, so that one is queued too; t0 and t1 are the account's own.
    expect([...late.pending.keys()].sort()).toEqual([
      rowKey('settings', 'app'),
      rowKey('tasks', 'only-j'),
    ])
    late.push()
    z.sync()
    late.sync()
    expect(w.model.get(ANA, 'tasks', 't0')?.deviceId).toBe('dev-z')
    expect(z.value('tasks', 'only-j')).toBe('dev-j:0')
  })

  it('an xpEvents id both devices wrote is one row afterwards, and every other id is kept', () => {
    const w = new World(prng(13))
    const a = w.add('dev-a')
    a.edit('xpEvents', 'xp:dailyGoal:2026-10-01#0')
    a.edit('xpEvents', 'xp:task:t1#0')
    a.push()
    const late = w.add('dev-b', 0, false)
    late.edit('xpEvents', 'xp:dailyGoal:2026-10-01#0') // paid offline on the phone too
    late.edit('xpEvents', 'xp:task:t2#0')
    late.join()
    late.push()
    a.sync()
    late.sync()
    const ids = w.model
      .rows(ANA)
      .filter((r) => r.tbl === 'xpEvents')
      .map((r) => r.id)
      .sort()
    expect(ids).toEqual(['xp:dailyGoal:2026-10-01#0', 'xp:task:t1#0', 'xp:task:t2#0'])
    for (const d of [a, late]) {
      expect([...d.rows.keys()].filter((k) => k.startsWith('xpEvents:')).sort()).toEqual(
        ids.map((id) => `xpEvents:${id}`),
      )
      expect(d.value('xpEvents', 'xp:dailyGoal:2026-10-01#0')).toBe('dev-a:0') // the account's copy
    }
    expect(late.pending.size).toBe(0)
  })
})

// ─── The property test ──────────────────────────────────────────────────────

interface Config {
  /** Tables the random edits go to, each with a small pool of ids so devices collide. */
  keys: readonly (readonly [SyncTableName, string])[]
  offsets: readonly number[]
  deletes: boolean
  settings: boolean
  joiner: boolean
}

const DEVICE_IDS = [
  '0b9f6c1e-1d2a-4f0b-8a55-3d6f0c4e9a10',
  '7e3d21aa-5c08-4b79-9d3f-a1b2c3d4e5f6',
  'f3a1d9c0-77b2-4c1e-9a0d-5e2b8c7d1f42',
]

interface Outcome {
  world: World
  devices: SimDevice[]
  maxNow: number
}

function simulate(seed: number, cfg: Config): Outcome {
  const rand = prng(seed)
  const world = new World(rand)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T
  const ids = [...DEVICE_IDS].sort(() => rand() - 0.5)
  const count = rand() < 0.5 ? 2 : 3
  const devices: SimDevice[] = []
  for (let i = 0; i < count; i += 1) {
    const isJoiner = cfg.joiner && i === count - 1
    devices.push(world.add(ids[i] as string, pick(cfg.offsets), !isJoiner))
  }
  const joiner = cfg.joiner ? devices[count - 1] : undefined
  const steps = 40 + Math.floor(rand() * 60)
  const joinAt = Math.floor(rand() * steps)
  let maxNow = world.now
  for (let step = 0; step < steps; step += 1) {
    if (rand() < 0.6) world.now += Math.floor(rand() * 40)
    maxNow = Math.max(maxNow, world.now)
    if (joiner !== undefined && !joiner.steady && step >= joinAt) joiner.join()
    const d = pick(devices)
    const roll = rand()
    if (roll < 0.32) {
      if (cfg.settings && rand() < 0.15) d.edit('settings', 'app')
      else {
        const [tbl, id] = pick(cfg.keys)
        d.edit(tbl, id)
      }
    } else if (roll < 0.4) {
      if (cfg.deletes) {
        const [tbl, id] = pick(cfg.keys)
        d.remove(tbl, id)
      }
    } else if (roll < 0.43) {
      if (cfg.settings) d.changeAppearance(`theme-${step}`)
    } else if (roll < 0.7) {
      world.now += 1 // a request takes a millisecond: a pull never sees a row from the very instant it is pushed
      const count = rand() < 0.3 ? Number.POSITIVE_INFINITY : 1 + Math.floor(rand() * 3)
      d.push(count, pick([undefined, 250, 600]), rand() < 0.15)
    } else {
      world.now += 1
      world.pageSize = 1 + Math.floor(rand() * 5)
      d.pull(1 + Math.floor(rand() * 3))
    }
  }
  joiner?.join()
  world.pageSize = 500
  for (let round = 0; round < 2; round += 1) for (const d of devices) d.sync()
  return { world, devices, maxNow: Math.max(maxNow, world.now) }
}

/** Every replica equals the server, every queue is empty, and the server holds no stamp from the far future. */
function expectConverged({ world, devices, maxNow }: Outcome, label: string): void {
  const server = world.model.rows(ANA)
  const maxSeq = server.reduce((max, r) => Math.max(max, r.seq), 0)
  for (const d of devices) {
    expect(d.pending.size, `${label}: ${d.id} has entries left`).toBe(0)
    expect(d.cursor, `${label}: ${d.id} cursor`).toBe(maxSeq)
    for (const row of server) {
      const key = rowKey(row.tbl, row.id)
      const local = d.rows.get(key)
      if (row.deleted) {
        expect(local, `${label}: ${d.id} ${key} should be deleted`).toBeUndefined()
      } else if (row.tbl === 'settings') {
        expect(syncedSettings(local), `${label}: ${d.id} ${key}`).toEqual(row.data)
      } else {
        expect(local, `${label}: ${d.id} ${key}`).toEqual(row.data)
      }
    }
    const live = new Set(server.filter((r) => !r.deleted).map((r) => rowKey(r.tbl, r.id)))
    for (const key of d.rows.keys()) {
      if (key === rowKey('settings', 'app')) continue // every device has its own default until one syncs
      expect(live.has(key), `${label}: ${d.id} has ${key}, which the server does not`).toBe(true)
    }
  }
  for (const row of server) {
    expect(row.updatedAt, `${label}: ${row.tbl}/${row.id} stamp`).toBeLessThanOrEqual(
      maxNow + 5 * MIN,
    )
    if (row.deleted) expect(row.data).toBeNull()
    if (row.tbl === 'settings') {
      expect('appearance' in (row.data as Row)).toBe(false)
      expect('notifications' in (row.data as Row)).toBe(false)
    }
  }
}

/** The write with the maximal stamp for a key, over every device's last write to it. */
function winnerOf(byDevice: Map<string, Write>): {
  at: number
  device: string
  deleted: boolean
  v: string | null
} {
  let best: { at: number; device: string; deleted: boolean; v: string | null } | null = null
  for (const [device, w] of byDevice) {
    const candidate = { at: w.at, device, deleted: w.deleted, v: w.v }
    if (best === null || newer(candidate, best)) best = candidate
  }
  if (best === null) throw new Error('no writes')
  return best
}

const TASKS: Config['keys'] = [
  ['tasks', 't0'],
  ['tasks', 't1'],
  ['tasks', 't2'],
  ['tasks', 't3'],
  ['tasks', 't4'],
]
const EVENTS: Config['keys'] = [
  ['xpEvents', 'xp:dailyGoal:2026-10-01#0'],
  ['xpEvents', 'xp:dailyGoal:2026-10-02#0'],
  ['xpEvents', 'xp:task:t1#0'],
  ['xpEvents', 'xp:task:t1#1'],
  ['xpEvents', 'xp:task:t2#0'],
  ['xpEvents', 'xp:task:t3#0'],
  ['xpEvents', 'xp:task:t4#0'],
]
const SMALL_OFFSETS = [-2_000, -500, 0, 0, 0, 500, 2_000]
const WILD_OFFSETS = [-3 * 3_600_000, -20 * MIN, 0, 0, 20 * MIN, 3_600_000, 5 * 3_600_000]

describe('random interleavings converge (seeded, 2–3 devices)', () => {
  const RUNS = 500 // records; the other three run half as many, to keep the four together near 1.5 s
  const HALF = RUNS / 2

  it('records: edits, deletes, partial pushes and pulls, a device joining, random clock offsets', () => {
    for (let seed = 1; seed <= RUNS; seed += 1) {
      const cfg: Config = {
        keys: TASKS,
        offsets: SMALL_OFFSETS,
        deletes: true,
        settings: false,
        joiner: seed % 2 === 0,
      }
      const outcome = simulate(seed, cfg)
      expectConverged(outcome, `seed ${seed}`)
      // Every key holds the newer-maximal write of all the writes made to it.
      for (const [key, byDevice] of outcome.world.writes) {
        const at = key.indexOf(':')
        const tbl = key.slice(0, at)
        const id = key.slice(at + 1)
        const winner = winnerOf(byDevice)
        const stored = outcome.world.model.get(ANA, tbl, id)
        expect(stored, `seed ${seed}: ${key} on the server`).toBeDefined()
        expect(stored?.deleted, `seed ${seed}: ${key} deleted?`).toBe(winner.deleted)
        for (const d of outcome.devices) {
          const v = (d.rows.get(key) as Row | undefined)?.v
          expect(v ?? null, `seed ${seed}: ${key} on ${d.id}`).toBe(winner.v)
        }
      }
    }
  })

  it('the settings row: synced fields converge, each device keeps its own theme', () => {
    for (let seed = 1; seed <= HALF; seed += 1) {
      const cfg: Config = {
        keys: TASKS,
        offsets: SMALL_OFFSETS,
        deletes: true,
        settings: true,
        joiner: seed % 2 === 1,
      }
      const outcome = simulate(seed + 10_000, cfg)
      expectConverged(outcome, `seed ${seed}`)
      const key = rowKey('settings', 'app')
      const edits = outcome.world.writes.get(key)
      if (edits !== undefined) {
        const winner = winnerOf(edits)
        for (const d of outcome.devices) {
          expect(
            ((d.rows.get(key) as Row).profile as Row).name,
            `seed ${seed}: settings on ${d.id}`,
          ).toBe(winner.v)
        }
      }
      const names = new Set(
        outcome.devices.map((d) => ((d.rows.get(key) as Row).profile as Row).name),
      )
      expect(names.size, `seed ${seed}: one settings value everywhere`).toBe(1)
      for (const d of outcome.devices) {
        expect(
          ((d.rows.get(key) as Row).appearance as Row).theme,
          `seed ${seed}: ${d.id} theme`,
        ).toBe(d.theme)
      }
    }
  })

  it('xpEvents: ids collide across devices; one row per id everywhere and no id is lost', () => {
    for (let seed = 1; seed <= HALF; seed += 1) {
      const cfg: Config = {
        keys: EVENTS,
        offsets: SMALL_OFFSETS,
        deletes: false,
        settings: false,
        joiner: seed % 2 === 0,
      }
      const outcome = simulate(seed + 20_000, cfg)
      expectConverged(outcome, `seed ${seed}`)
      for (const key of outcome.world.writes.keys()) {
        const at = key.indexOf(':')
        const stored = outcome.world.model.get(ANA, key.slice(0, at), key.slice(at + 1))
        expect(stored, `seed ${seed}: ${key} kept`).toBeDefined()
        expect(stored?.deleted).toBe(false)
      }
    }
  })

  it('clocks hours off, ahead and behind: still one state everywhere, no stamp past server time + 5 min', () => {
    for (let seed = 1; seed <= HALF; seed += 1) {
      const cfg: Config = {
        keys: TASKS,
        offsets: WILD_OFFSETS,
        deletes: true,
        settings: false,
        joiner: true, // every run: a joiner adopting rows stored at the cap is where the clocks bite
      }
      expectConverged(simulate(seed + 30_000, cfg), `seed ${seed}`)
    }
  })
})
