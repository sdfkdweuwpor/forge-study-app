import { describe, expect, it } from 'vitest'
import type { SyncErrorKind, SyncOutboxEntry } from '@/db/types'
import {
  advancePull,
  backoffMs,
  BACKOFF_STEPS_MS,
  batchRows,
  BATCH_MAX_BYTES,
  blockSignature,
  classifyPage,
  classifySyncError,
  clampStamp,
  compareStamps,
  decideApply,
  emptySeedIndex,
  fitsKeepalive,
  findNewerSchema,
  indexRemoteSeedRow,
  isSettled,
  KEEPALIVE_MAX_BYTES,
  maxStamp,
  mergePolicy,
  mergeRemoteSettings,
  migrateRows,
  needsRefresh,
  newer,
  nextPushEntries,
  noteIdenticalRow,
  observeRemoteStamp,
  orderOutbox,
  parseRetryAfter,
  parseRowKey,
  planBootstrapQueue,
  planRetry,
  prepareRemoteRow,
  PULL_PAGE_SIZE,
  pushRowBytes,
  RATE_LIMIT_FLOOR_MS,
  RETRY_AFTER_CAP_MS,
  rowKey,
  sameRow,
  seedDuplicates,
  splitBatch,
  stampCeiling,
  STAMP_CLAMP_MS,
  startPull,
  SyncTransportError,
  tickStamp,
  toServerRow,
  tokenNeedsRefresh,
  UNION_TABLES,
  utf8Length,
  type ApplyInput,
  type PushRow,
  type RemoteIndexEntry,
  type RowVerdict,
  type ServerRow,
  type Stamp,
  type StampClock,
} from './sync'
import { APPEND_ONLY_TABLES, syncedSettingsChanged, type SyncTableName } from './syncTables'

/** A small seeded PRNG (mulberry32), so a failing case can be replayed. */
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

const SELF = 'dev-m'
const LOW = 'dev-a' // sorts before SELF
const HIGH = 'dev-z' // sorts after SELF

// ─── Stamps ─────────────────────────────────────────────────────────────────

describe('newer', () => {
  const stamps: Stamp[] = []
  for (const at of [1, 2, 3]) for (const device of ['a', 'b', 'c']) stamps.push({ at, device })

  /** The SQL rule, written the other way round: `(a.at, a.device) > (b.at, b.device)`. */
  const sql = (a: Stamp, b: Stamp): boolean => a.at > b.at || (a.at === b.at && a.device > b.device)

  it('equals the trigger rule for every pair (ties, same device, equal stamps)', () => {
    for (const a of stamps)
      for (const b of stamps)
        expect(newer(a, b), `${a.at}${a.device} ${b.at}${b.device}`).toBe(sql(a, b))
  })

  it('is a strict total order: irreflexive, exactly one direction unless equal, transitive', () => {
    for (const a of stamps) {
      expect(newer(a, a)).toBe(false)
      for (const b of stamps) {
        const equal = a.at === b.at && a.device === b.device
        expect(newer(a, b) || newer(b, a) || equal).toBe(true)
        expect(newer(a, b) && newer(b, a)).toBe(false)
        expect(compareStamps(a, b) + compareStamps(b, a)).toBe(0)
        for (const c of stamps) if (newer(a, b) && newer(b, c)) expect(newer(a, c)).toBe(true)
      }
    }
  })

  it('breaks an equal-stamp tie by the larger device id, and an equal stamp from one device is not newer', () => {
    const at = 1_800_000_000_000
    const small = { at, device: '0b9f6c1e-1d2a-4f0b-8a55-3d6f0c4e9a10' }
    const large = { at, device: 'f3a1d9c0-77b2-4c1e-9a0d-5e2b8c7d1f42' }
    expect(newer(large, small)).toBe(true)
    expect(newer(small, large)).toBe(false)
    expect(newer(small, { ...small })).toBe(false)
    expect(maxStamp(small, large)).toBe(large)
    expect(maxStamp(large, small)).toBe(large)
    expect(maxStamp(small, { ...small })).toEqual(small)
  })

  it('lets a later stamp beat a larger device id', () => {
    expect(newer({ at: 11, device: 'a' }, { at: 10, device: 'z' })).toBe(true)
  })
})

describe('the write stamp clock', () => {
  it('is strictly increasing however the wall clock moves', () => {
    const rand = prng(7)
    let clock: StampClock = { last: 0, maxSeen: 0 }
    let previous = 0
    let now = 1_800_000_000_000
    for (let i = 0; i < 500; i += 1) {
      now += Math.floor(rand() * 20) - 12 // often backwards
      const tick = tickStamp(clock, now)
      expect(tick.at).toBeGreaterThan(previous)
      expect(tick.at).toBeGreaterThanOrEqual(now)
      previous = tick.at
      clock = tick.clock
    }
  })

  it('goes past every remote stamp seen, whatever this clock says', () => {
    let clock: StampClock = { last: 0, maxSeen: 0 }
    clock = observeRemoteStamp(clock, 5_000, Number.POSITIVE_INFINITY)
    const tick = tickStamp(clock, 1_000)
    expect(tick.at).toBe(5_001)
    expect(tickStamp(tick.clock, 1_000).at).toBe(5_002)
  })

  it('only grows maxSeen, and ignores a stamp above the ceiling', () => {
    const start: StampClock = { last: 10, maxSeen: 500 }
    expect(observeRemoteStamp(start, 400, Infinity)).toBe(start)
    expect(observeRemoteStamp(start, 800, Infinity)).toEqual({ last: 10, maxSeen: 800 })
    const ceiling = stampCeiling(1_000)
    expect(ceiling).toBe(1_000 + STAMP_CLAMP_MS)
    expect(observeRemoteStamp(start, ceiling + 1, ceiling)).toBe(start)
    expect(observeRemoteStamp(start, ceiling, ceiling).maxSeen).toBe(ceiling)
    expect(observeRemoteStamp(start, Number.NaN, ceiling)).toBe(start)
    expect(stampCeiling(null)).toBe(Number.POSITIVE_INFINITY)
  })

  it('an edit made after seeing a change beats it, even when this clock is far behind', () => {
    const theirs: Stamp = { at: 2_000_000, device: HIGH }
    const seen = observeRemoteStamp({ last: 0, maxSeen: 0 }, theirs.at, Infinity)
    const mine = tickStamp(seen, 10)
    expect(newer({ at: mine.at, device: LOW }, theirs)).toBe(true)
  })

  it('clamps at server time plus five minutes, as the trigger does', () => {
    expect(clampStamp(1_000, 500_000)).toBe(1_000)
    expect(clampStamp(10 ** 12, 500_000)).toBe(500_000 + 300_000)
    expect(clampStamp(800_000, 500_000)).toBe(800_000)
    expect(clampStamp(800_001, 500_000)).toBe(800_000)
  })
})

describe('row keys', () => {
  it('round trip, with colons inside the id', () => {
    const key = rowKey('xpEvents', 'xp:task:t1#0')
    expect(key).toBe('xpEvents:xp:task:t1#0')
    expect(parseRowKey(key)).toEqual({ tbl: 'xpEvents', id: 'xp:task:t1#0' })
    expect(parseRowKey('nocolon')).toBeNull()
    expect(parseRowKey(':x')).toBeNull()
  })
})

// ─── Errors and retries ─────────────────────────────────────────────────────

describe('classifySyncError', () => {
  const cases: [string, Parameters<typeof classifySyncError>[0], SyncErrorKind][] = [
    ['fetch rejected', { status: null }, 'offline'],
    ['browser says offline', { status: null, offline: true }, 'offline'],
    ['offline wins over a status', { status: 503, offline: true }, 'offline'],
    ['timeout', { status: null, timedOut: true }, 'server'],
    ['500', { status: 500 }, 'server'],
    ['502', { status: 502 }, 'server'],
    ['503', { status: 503 }, 'server'],
    ['504', { status: 504 }, 'server'],
    ['520 (unknown error)', { status: 520 }, 'server'],
    ['522 (timed out)', { status: 522 }, 'server'],
    ['540 (paused project)', { status: 540 }, 'server'],
    ['429', { status: 429 }, 'rateLimited'],
    ['429 with a GoTrue code', { status: 429, code: 'over_email_send_rate_limit' }, 'rateLimited'],
    ['request rate limit code', { status: 400, code: 'over_request_rate_limit' }, 'rateLimited'],
    ['refresh answers 400', { status: 400, refresh: true }, 'signedOut'],
    [
      'refresh answers invalid_grant',
      { status: 400, refresh: true, code: 'invalid_grant' },
      'signedOut',
    ],
    ['invalid_grant anywhere', { status: 400, code: 'invalid_grant' }, 'signedOut'],
    ['token already used', { status: 400, code: 'refresh_token_already_used' }, 'signedOut'],
    ['401', { status: 401 }, 'signedOut'],
    ['401 expired JWT', { status: 401, code: 'PGRST301' }, 'signedOut'],
    [
      '401 permission denied is the anon role: not signed in',
      { status: 401, code: '42501' },
      'signedOut',
    ],
    ['table missing', { status: 404, code: 'PGRST205' }, 'setup'],
    ['forge_now missing', { status: 404, code: 'PGRST202' }, 'setup'],
    ['undefined_table', { status: 404, code: '42P01' }, 'setup'],
    ['undefined_table as a 400', { status: 400, code: '42P01' }, 'setup'],
    ['rls / grants missing (403)', { status: 403, code: '42501' }, 'forbidden'],
    ['403 without a code', { status: 403 }, 'forbidden'],
    ['42501 without a usable status', { status: 400, code: '42501' }, 'forbidden'],
    ['413', { status: 413 }, 'tooLarge'],
    ['a bare 404 is not a setup problem', { status: 404 }, 'server'],
    ['an unlisted 400', { status: 400 }, 'server'],
    ['an unlisted 409', { status: 409, code: '23505' }, 'server'],
    ['a plain 400 that is not a refresh', { status: 400, code: 'validation_failed' }, 'server'],
  ]
  it.each(cases)('%s', (_name, failure, kind) => {
    expect(classifySyncError(failure)).toBe(kind)
  })

  it('never answers with a kind that does not come from a response', () => {
    const rand = prng(3)
    const statuses = [null, 200, 400, 401, 403, 404, 409, 413, 429, 500, 503, 540]
    const codes = [null, 'PGRST205', '42501', 'invalid_grant', 'x']
    for (let i = 0; i < 200; i += 1) {
      const kind = classifySyncError({
        status: statuses[Math.floor(rand() * statuses.length)] ?? null,
        code: codes[Math.floor(rand() * codes.length)] ?? null,
        refresh: rand() < 0.3,
        timedOut: rand() < 0.2,
        offline: rand() < 0.1,
      })
      expect(['updateNeeded', 'snapshot']).not.toContain(kind)
    }
  })

  it('refreshes once after a 401, never twice', () => {
    expect(needsRefresh(401, false)).toBe(true)
    expect(needsRefresh(401, true)).toBe(false)
    expect(needsRefresh(403, false)).toBe(false)
    expect(needsRefresh(null, false)).toBe(false)
  })

  it('refreshes a token a minute before it expires', () => {
    expect(tokenNeedsRefresh(1_000_000, 1_000_000 - 60_001)).toBe(false)
    expect(tokenNeedsRefresh(1_000_000, 1_000_000 - 60_000)).toBe(false)
    expect(tokenNeedsRefresh(1_000_000, 1_000_000 - 59_999)).toBe(true)
    expect(tokenNeedsRefresh(1_000_000, 2_000_000)).toBe(true)
  })
})

describe('SyncTransportError', () => {
  it('carries its kind, status, code and Retry-After', () => {
    const err = new SyncTransportError('rateLimited', 'Slow down', {
      status: 429,
      code: 'over_request_rate_limit',
      retryAfterMs: 30_000,
    })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('SyncTransportError')
    expect(err.kind).toBe('rateLimited')
    expect(err.status).toBe(429)
    expect(err.code).toBe('over_request_rate_limit')
    expect(err.retryAfterMs).toBe(30_000)
    expect(err.message).toBe('Slow down')
    const bare = new SyncTransportError('offline', 'No connection')
    expect([bare.status, bare.code, bare.retryAfterMs]).toEqual([null, null, null])
  })
})

describe('backoffMs', () => {
  it('follows 15 s, 1 min, 5 min, 15 min and stays at the cap', () => {
    expect(BACKOFF_STEPS_MS).toEqual([15_000, 60_000, 300_000, 900_000])
    expect([1, 2, 3, 4, 5, 6, 50].map((n) => backoffMs(n, 0.5))).toEqual([
      15_000, 60_000, 300_000, 900_000, 900_000, 900_000, 900_000,
    ])
  })

  it('jitters by at most 20 percent either way, and is deterministic for a given random', () => {
    for (const [n, base] of BACKOFF_STEPS_MS.map((b, i) => [i + 1, b] as const)) {
      expect(backoffMs(n, 0)).toBe(Math.round(base * 0.8))
      expect(backoffMs(n, 0.999999)).toBeLessThanOrEqual(Math.round(base * 1.2))
      expect(backoffMs(n, 0.25)).toBe(backoffMs(n, 0.25))
      const rand = prng(n)
      for (let i = 0; i < 100; i += 1) {
        const d = backoffMs(n, rand())
        expect(d).toBeGreaterThanOrEqual(base * 0.8 - 1)
        expect(d).toBeLessThanOrEqual(base * 1.2 + 1)
      }
    }
  })

  it('treats odd input as the first failure and keeps random in range', () => {
    expect(backoffMs(0, 0.5)).toBe(15_000)
    expect(backoffMs(-3, 0.5)).toBe(15_000)
    expect(backoffMs(Number.NaN, 0.5)).toBe(15_000)
    expect(backoffMs(1, -5)).toBe(backoffMs(1, 0))
    expect(backoffMs(1, 9)).toBe(backoffMs(1, 1))
    expect(backoffMs(1, Number.NaN)).toBe(15_000)
    expect(backoffMs(2.9, 0.5)).toBe(60_000)
  })
})

describe('parseRetryAfter', () => {
  const NOW = Date.UTC(2026, 9, 1, 12, 0, 0)
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('30', NOW)).toBe(30_000)
    expect(parseRetryAfter(' 0 ', NOW)).toBe(0)
    expect(parseRetryAfter('Thu, 01 Oct 2026 12:01:30 GMT', NOW)).toBe(90_000)
    expect(parseRetryAfter('Thu, 01 Oct 2026 11:00:00 GMT', NOW)).toBe(0)
  })
  it('reads the obsolete HTTP date forms too', () => {
    expect(parseRetryAfter('Thursday, 01-Oct-26 12:00:45 GMT', NOW)).toBe(45_000)
  })
  it('is null when absent or unreadable', () => {
    expect(parseRetryAfter(null, NOW)).toBeNull()
    expect(parseRetryAfter(undefined, NOW)).toBeNull()
    expect(parseRetryAfter('', NOW)).toBeNull()
    expect(parseRetryAfter('soon', NOW)).toBeNull()
  })
  it('does not let a lenient date parser turn junk into a date in the past', () => {
    for (const junk of [
      '12.5',
      '-5',
      'foo 10',
      '1e3',
      '10 seconds',
      '2026-10-01',
      'Oct 1 2026',
      '10 GMT',
    ]) {
      expect(parseRetryAfter(junk, NOW), junk).toBeNull()
    }
  })
})

describe('planRetry', () => {
  const NOW = 1_800_000_000_000
  const ctx = (over: Partial<Parameters<typeof planRetry>[1]> = {}) => ({
    now: NOW,
    failures: 1,
    random: 0.5,
    ...over,
  })

  it('offline waits for the online event, with the backoff as a fallback', () => {
    expect(planRetry('offline', ctx())).toEqual({ mode: 'online', at: NOW + 15_000 })
    expect(planRetry('offline', ctx({ failures: 3 }))).toEqual({
      mode: 'online',
      at: NOW + 300_000,
    })
  })

  it('server errors and a failed snapshot back off on the schedule', () => {
    for (const kind of ['server', 'snapshot'] as const) {
      expect([1, 2, 3, 4, 9].map((failures) => planRetry(kind, ctx({ failures })))).toEqual(
        [15_000, 60_000, 300_000, 900_000, 900_000].map((d) => ({ mode: 'at', at: NOW + d })),
      )
    }
  })

  it('a 429 waits at least Retry-After, or a minute when there is none', () => {
    expect(planRetry('rateLimited', ctx())).toEqual({ mode: 'at', at: NOW + RATE_LIMIT_FLOOR_MS })
    expect(planRetry('rateLimited', ctx({ retryAfterMs: 30 * 60_000 }))).toEqual({
      mode: 'at',
      at: NOW + 30 * 60_000,
    })
    // A Retry-After that asks for nothing (zero, negative, not a number) leaves the floor in place.
    for (const retryAfterMs of [0, -5_000, Number.NaN, null]) {
      expect(planRetry('rateLimited', ctx({ retryAfterMs }))).toEqual({
        mode: 'at',
        at: NOW + RATE_LIMIT_FLOOR_MS,
      })
    }
    // A short Retry-After never shortens the backoff.
    expect(planRetry('rateLimited', ctx({ failures: 3, retryAfterMs: 5_000 }))).toEqual({
      mode: 'at',
      at: NOW + 300_000,
    })
    // An absurd one is capped.
    expect(planRetry('rateLimited', ctx({ retryAfterMs: 48 * 3_600_000 }))).toEqual({
      mode: 'at',
      at: NOW + RETRY_AFTER_CAP_MS,
    })
  })

  it('a 413 shrinks the batch; the rest stop until the person acts', () => {
    expect(planRetry('tooLarge', ctx())).toEqual({ mode: 'shrink' })
    for (const kind of ['signedOut', 'setup', 'forbidden', 'updateNeeded'] as const) {
      expect(planRetry(kind, ctx())).toEqual({ mode: 'manual' })
    }
  })
})

// ─── decideApply ────────────────────────────────────────────────────────────

describe('decideApply (the table of PLAN §4.7.5)', () => {
  const input = (over: Partial<ApplyInput> & { remote: ApplyInput['remote'] }): ApplyInput => ({
    mode: 'steady',
    self: SELF,
    tbl: 'tasks',
    pending: null,
    local: { updatedAt: 1_000 },
    ...over,
  })
  const remote = (at: number, device: string, deleted = false) => ({ at, device, deleted })

  type Row = [string, ApplyInput, { apply: boolean; dropPending: boolean; reason: string }]
  const yes = (reason: string, dropPending = false) => ({ apply: true, dropPending, reason })
  const no = (reason: string) => ({ apply: false, dropPending: false, reason })

  const rows: Row[] = [
    // steady, a pending entry
    [
      'steady, pending, remote newer',
      input({ pending: { at: 100 }, remote: remote(101, LOW) }),
      yes('remoteNewer', true),
    ],
    [
      'steady, pending, remote older',
      input({ pending: { at: 100 }, remote: remote(99, HIGH) }),
      no('localNewer'),
    ],
    [
      'steady, pending, tie, remote device larger',
      input({ pending: { at: 100 }, remote: remote(100, HIGH) }),
      yes('remoteNewer', true),
    ],
    [
      'steady, pending, tie, remote device smaller',
      input({ pending: { at: 100 }, remote: remote(100, LOW) }),
      no('localNewer'),
    ],
    [
      'steady, pending, our own push, same stamp',
      input({ pending: { at: 100 }, remote: remote(100, SELF) }),
      no('echo'),
    ],
    [
      'steady, pending, our own older push',
      input({ pending: { at: 200 }, remote: remote(100, SELF) }),
      no('localNewer'),
    ],
    [
      'steady, pending, remote tombstone newer',
      input({ pending: { at: 100 }, remote: remote(300, LOW, true) }),
      yes('remoteNewer', true),
    ],
    [
      'steady, pending, remote tombstone older',
      input({ pending: { at: 100 }, remote: remote(50, HIGH, true) }),
      no('localNewer'),
    ],
    // steady, no entry
    ['steady, no entry, echo of our own push', input({ remote: remote(5_000, SELF) }), no('echo')],
    ['steady, no entry, echo, tombstone', input({ remote: remote(5_000, SELF, true) }), no('echo')],
    ['steady, no entry, another device', input({ remote: remote(5_000, LOW) }), yes('lastSynced')],
    [
      'steady, no entry, another device, older than the row',
      input({ remote: remote(1, LOW) }),
      yes('lastSynced'),
    ],
    [
      'steady, no entry, tombstone',
      input({ remote: remote(5_000, HIGH, true) }),
      yes('lastSynced'),
    ],
    [
      'steady, no entry, no local row',
      input({ remote: remote(5_000, LOW), local: null }),
      yes('lastSynced'),
    ],
    [
      'steady, settings, no entry',
      input({ tbl: 'settings', remote: remote(5_000, LOW) }),
      yes('lastSynced'),
    ],
    // bootstrap, a pending entry: as steady
    [
      'bootstrap, pending, remote newer',
      input({ mode: 'bootstrap', pending: { at: 100 }, remote: remote(101, LOW) }),
      yes('remoteNewer', true),
    ],
    [
      'bootstrap, pending, remote older',
      input({ mode: 'bootstrap', pending: { at: 100 }, remote: remote(99, HIGH) }),
      no('localNewer'),
    ],
    [
      'bootstrap, pending, tie by device',
      input({ mode: 'bootstrap', pending: { at: 100 }, remote: remote(100, HIGH) }),
      yes('remoteNewer', true),
    ],
    // bootstrap, no entry, no row
    [
      'bootstrap, no entry, row absent',
      input({ mode: 'bootstrap', local: null, remote: remote(1, LOW) }),
      yes('absent'),
    ],
    [
      'bootstrap, no entry, row absent, tombstone (nothing to do)',
      input({ mode: 'bootstrap', local: null, remote: remote(1, LOW, true) }),
      yes('absent'),
    ],
    // bootstrap, no entry, row present: remote against the row's updatedAt
    [
      'bootstrap, row present, remote newer',
      input({ mode: 'bootstrap', local: { updatedAt: 1_000 }, remote: remote(1_001, LOW) }),
      yes('compared'),
    ],
    [
      'bootstrap, row present, remote older',
      input({ mode: 'bootstrap', local: { updatedAt: 1_000 }, remote: remote(999, HIGH) }),
      no('compared'),
    ],
    [
      'bootstrap, row present, tie, remote device larger',
      input({ mode: 'bootstrap', local: { updatedAt: 1_000 }, remote: remote(1_000, HIGH) }),
      yes('compared'),
    ],
    [
      'bootstrap, row present, tie, remote device smaller',
      input({ mode: 'bootstrap', local: { updatedAt: 1_000 }, remote: remote(1_000, LOW) }),
      no('compared'),
    ],
    [
      'bootstrap, row present, our own earlier push (interrupted first sync)',
      input({ mode: 'bootstrap', local: { updatedAt: 1_000 }, remote: remote(1_000, SELF) }),
      no('compared'),
    ],
    [
      'bootstrap, row present, newer tombstone deletes it',
      input({ mode: 'bootstrap', local: { updatedAt: 1_000 }, remote: remote(2_000, LOW, true) }),
      yes('compared'),
    ],
    [
      'bootstrap, row present, older tombstone keeps it (it is queued later)',
      input({ mode: 'bootstrap', local: { updatedAt: 3_000 }, remote: remote(2_000, LOW, true) }),
      no('compared'),
    ],
    // bootstrap, settings
    [
      'bootstrap, settings, remote exists: adopt, even when older',
      input({
        mode: 'bootstrap',
        tbl: 'settings',
        local: { updatedAt: 9_000 },
        remote: remote(1, LOW),
      }),
      yes('adoptSettings'),
    ],
    [
      'bootstrap, settings, remote tombstone: compared',
      input({
        mode: 'bootstrap',
        tbl: 'settings',
        local: { updatedAt: 9_000 },
        remote: remote(1, LOW, true),
      }),
      no('compared'),
    ],
    [
      'bootstrap, settings, pending entry: as steady',
      input({
        mode: 'bootstrap',
        tbl: 'settings',
        pending: { at: 500 },
        local: { updatedAt: 500 },
        remote: remote(400, LOW),
      }),
      no('localNewer'),
    ],
    // bootstrap, xpEvents (union)
    [
      'bootstrap, xpEvents, same id on both sides: the server copy is adopted, even when older',
      input({
        mode: 'bootstrap',
        tbl: 'xpEvents',
        local: { updatedAt: 9_000 },
        remote: remote(1, LOW),
      }),
      yes('unionRemote'),
    ],
    [
      'bootstrap, xpEvents, remote tombstone: compared',
      input({
        mode: 'bootstrap',
        tbl: 'xpEvents',
        local: { updatedAt: 9_000 },
        remote: remote(1, LOW, true),
      }),
      no('compared'),
    ],
    [
      'steady, xpEvents, is ordinary',
      input({ tbl: 'xpEvents', remote: remote(1, LOW) }),
      yes('lastSynced'),
    ],
  ]

  it.each(rows)('%s', (_name, i, expected) => {
    expect(decideApply(i)).toEqual(expected)
  })

  it('holds its invariants over mode × table × pending × device × tombstone × row × tie', () => {
    const tables: SyncTableName[] = ['tasks', 'settings', 'xpEvents']
    const around = [-1, 0, 1] // relative to 1_000
    const devices = [SELF, LOW, HIGH]
    let count = 0
    for (const mode of ['steady', 'bootstrap'] as const)
      for (const tbl of tables)
        for (const pendingRel of [null, ...around])
          for (const localRel of [null, ...around])
            for (const remoteRel of around)
              for (const device of devices)
                for (const deleted of [false, true]) {
                  const i: ApplyInput = {
                    mode,
                    self: SELF,
                    tbl,
                    pending: pendingRel === null ? null : { at: 1_000 + pendingRel },
                    local: localRel === null ? null : { updatedAt: 1_000 + localRel },
                    remote: { at: 1_000 + remoteRel, device, deleted },
                  }
                  const d = decideApply(i)
                  count += 1
                  // Dropping the entry only ever happens when the remote row replaces the pending change.
                  if (d.dropPending) expect(i.pending !== null && d.apply).toBe(true)
                  if (i.pending !== null) {
                    // A pending change is settled by the stamp order alone, in both modes and for every table.
                    expect(d.apply).toBe(
                      newer({ at: i.remote.at, device }, { at: i.pending.at, device: SELF }),
                    )
                    expect(d.dropPending).toBe(d.apply)
                  } else if (mode === 'steady') {
                    // Steady state does not look at the local row or at stamps: only at echoes.
                    expect(d.apply).toBe(device !== SELF)
                  } else if (i.local === null) {
                    expect(d.apply).toBe(true)
                  } else if (!deleted && (tbl === 'settings' || tbl === 'xpEvents')) {
                    expect(d.apply).toBe(true)
                  } else {
                    expect(d.apply).toBe(
                      newer({ at: i.remote.at, device }, { at: i.local.updatedAt, device: SELF }),
                    )
                  }
                }
    expect(count).toBe(2 * 3 * 4 * 4 * 3 * 3 * 2)
  })
})

describe('the merge policy', () => {
  it('is union for xpEvents only, and only for append-only tables', () => {
    expect([...UNION_TABLES]).toEqual(['xpEvents'])
    for (const t of UNION_TABLES) expect(APPEND_ONLY_TABLES.has(t)).toBe(true)
    expect(mergePolicy('xpEvents')).toBe('union')
    expect(mergePolicy('tasks')).toBe('lww')
    expect(mergePolicy('blockEvents')).toBe('lww')
    expect(mergePolicy('settings')).toBe('lww')
  })
})

// ─── The settings row ───────────────────────────────────────────────────────

const settings = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'app',
  createdAt: 1,
  updatedAt: 2,
  profile: { name: 'Ana' },
  onboardedAt: 100,
  appearance: { theme: 'dark', accent: 'teal', reducedMotion: 'system' },
  weekStartsOn: 1,
  timer: { pomodoroMin: 25 },
  notifications: { enabled: true, promptedAt: 5 },
  blocker: {
    mode: 'focus',
    motivation: ['Keep going'],
    extensionIdOverride: 'abc',
    lastSyncedAt: 10,
    eventsCursor: 20,
    blocklistSeeded: true,
  },
  backup: { lastExportAt: 30, remindWeekly: true, lastRemindedAt: 40 },
  lastCelebratedLevel: 3,
  world: { seed: 42 },
  ...over,
})

describe('mergeRemoteSettings', () => {
  const local = settings()
  const remote = settings({
    updatedAt: 900,
    profile: { name: 'Ana M.' },
    weekStartsOn: 0,
    lastCelebratedLevel: 7,
    // Another device's own values for the device-only fields; they must never arrive.
    appearance: { theme: 'light', accent: 'rose', reducedMotion: 'reduce' },
    notifications: { enabled: false, promptedAt: 999 },
    blocker: {
      mode: 'strict',
      motivation: ['Later'],
      extensionIdOverride: 'other',
      lastSyncedAt: 777,
      eventsCursor: 888,
      blocklistSeeded: true,
    },
    backup: { lastExportAt: 31, remindWeekly: false, lastRemindedAt: 4_000 },
  })

  it("takes the account settings and keeps this device's own device-only fields", () => {
    const merged = mergeRemoteSettings(local, remote)
    expect(merged).not.toBeNull()
    expect(merged).toMatchObject({
      updatedAt: 900,
      profile: { name: 'Ana M.' },
      weekStartsOn: 0,
      lastCelebratedLevel: 7,
      // device-only: local values
      appearance: { theme: 'dark', accent: 'teal', reducedMotion: 'system' },
      notifications: { enabled: true, promptedAt: 5 },
      blocker: {
        extensionIdOverride: 'abc',
        lastSyncedAt: 10,
        eventsCursor: 20,
        // synced: remote values
        mode: 'strict',
        motivation: ['Later'],
        blocklistSeeded: true,
      },
      backup: { lastExportAt: 31, remindWeekly: false, lastRemindedAt: 40 },
    })
  })

  it('never lets a remote value overwrite a local device-only field, for any combination', () => {
    const merged = mergeRemoteSettings(local, remote) as Record<string, unknown>
    const blocker = merged.blocker as Record<string, unknown>
    const backup = merged.backup as Record<string, unknown>
    expect(merged.appearance).toEqual(local.appearance)
    expect(merged.notifications).toEqual(local.notifications)
    expect(blocker.extensionIdOverride).toBe('abc')
    expect(blocker.lastSyncedAt).toBe(10)
    expect(blocker.eventsCursor).toBe(20)
    expect(backup.lastRemindedAt).toBe(40)
  })

  it('does not change either argument', () => {
    const a = structuredClone(local)
    const b = structuredClone(remote)
    mergeRemoteSettings(a, b)
    expect(a).toEqual(local)
    expect(b).toEqual(remote)
  })

  it('takes a remote row that has no device-only fields (what a device pushes) as it is, plus the local ones', () => {
    const pushed = { ...remote } as Record<string, unknown>
    delete pushed.appearance
    delete pushed.notifications
    pushed.blocker = { mode: 'strict', motivation: [], blocklistSeeded: true }
    pushed.backup = { lastExportAt: 31, remindWeekly: false }
    const merged = mergeRemoteSettings(local, pushed) as Record<string, unknown>
    expect(merged.appearance).toEqual(local.appearance)
    expect(merged.blocker).toEqual({
      mode: 'strict',
      motivation: [],
      blocklistSeeded: true,
      extensionIdOverride: 'abc',
      lastSyncedAt: 10,
      eventsCursor: 20,
    })
    expect(merged.backup).toEqual({ lastExportAt: 31, remindWeekly: false, lastRemindedAt: 40 })
  })

  it('onboardedAt never goes from set to null, and the earliest non-null wins', () => {
    const on = (l: unknown, r: unknown) =>
      (
        mergeRemoteSettings(settings({ onboardedAt: l }), settings({ onboardedAt: r })) as Record<
          string,
          unknown
        >
      ).onboardedAt
    expect(on(100, null)).toBe(100)
    expect(on(null, 200)).toBe(200)
    expect(on(100, 200)).toBe(100)
    expect(on(300, 200)).toBe(200)
    expect(on(null, null)).toBeNull()
    // No local row at all.
    expect(
      (mergeRemoteSettings(undefined, settings({ onboardedAt: 5 })) as Record<string, unknown>)
        .onboardedAt,
    ).toBe(5)
  })

  it('a new device adopts the account settings and gets its device fields from the fallback', () => {
    const defaults = settings({
      appearance: { theme: 'system', accent: 'indigo', reducedMotion: 'system' },
      notifications: { enabled: false, promptedAt: null },
    })
    const merged = mergeRemoteSettings(undefined, remote, defaults) as Record<string, unknown>
    expect(merged.appearance).toEqual({
      theme: 'system',
      accent: 'indigo',
      reducedMotion: 'system',
    })
    expect(merged.profile).toEqual({ name: 'Ana M.' })
    // The local row wins over the fallback when both exist.
    const both = mergeRemoteSettings(local, remote, defaults) as Record<string, unknown>
    expect(both.appearance).toEqual(local.appearance)
    // Without either, the device fields are simply left out.
    const bare = mergeRemoteSettings(undefined, remote) as Record<string, unknown>
    expect('appearance' in bare).toBe(false)
    expect('notifications' in bare).toBe(false)
  })

  it('has nothing to apply for a remote that is not a settings object', () => {
    expect(mergeRemoteSettings(local, null)).toBeNull()
    expect(mergeRemoteSettings(local, 'x')).toBeNull()
    expect(mergeRemoteSettings(local, [1])).toBeNull()
  })

  it('a device-only change is not a change (so it is never pushed)', () => {
    const after = settings({
      updatedAt: 99,
      appearance: { theme: 'light', accent: 'rose', reducedMotion: 'reduce' },
      blocker: { ...(local.blocker as object), eventsCursor: 999, lastSyncedAt: 998 },
    })
    expect(syncedSettingsChanged(local, after)).toBe(false)
    expect(syncedSettingsChanged(local, settings({ weekStartsOn: 0 }))).toBe(true)
  })
})

// ─── toServerRow ────────────────────────────────────────────────────────────

describe('toServerRow', () => {
  const ctx = { deviceId: SELF, schemaVersion: 3 }
  const entry = (tbl: SyncTableName, id: string, at = 5_000): SyncOutboxEntry => ({ tbl, id, at })
  const task = {
    id: 't1',
    createdAt: 1,
    updatedAt: 2,
    title: 'C182 · Unit 3: Networking (45 min)',
    tags: ['C182', 'Ünïcode ✓'],
    notes: null,
    subtasks: [{ id: 's1', title: 'Read §3.2', done: false }],
    doDate: '2026-10-05',
    status: 'todo',
  }

  it("pushes a live row with the entry's stamp, not the row's updatedAt", () => {
    expect(toServerRow(entry('tasks', 't1', 7_777), task, ctx)).toEqual({
      kind: 'push',
      row: {
        tbl: 'tasks',
        id: 't1',
        updatedAt: 7_777,
        deviceId: SELF,
        deleted: false,
        schemaVersion: 3,
        data: task,
      },
    })
  })

  it('sends a tombstone for a row that is gone', () => {
    for (const gone of [undefined, null]) {
      expect(toServerRow(entry('tasks', 't1'), gone, ctx)).toEqual({
        kind: 'push',
        row: {
          tbl: 'tasks',
          id: 't1',
          updatedAt: 5_000,
          deviceId: SELF,
          deleted: true,
          schemaVersion: 3,
          data: null,
        },
      })
    }
  })

  it('JSON round trip of the data equals the row', () => {
    const d = toServerRow(entry('tasks', 't1'), task, ctx)
    expect(d.kind).toBe('push')
    if (d.kind === 'push') expect(JSON.parse(JSON.stringify(d.row.data))).toEqual(task)
    const s = toServerRow(entry('settings', 'app'), settings(), ctx)
    if (s.kind === 'push') expect(JSON.parse(JSON.stringify(s.row.data))).toEqual(s.row.data)
  })

  it('strips the device-only fields from the settings row', () => {
    const d = toServerRow(entry('settings', 'app'), settings(), ctx)
    expect(d.kind).toBe('push')
    if (d.kind !== 'push') return
    const data = d.row.data as Record<string, unknown>
    expect('appearance' in data).toBe(false)
    expect('notifications' in data).toBe(false)
    const blocker = data.blocker as Record<string, unknown>
    expect(blocker).toEqual({ mode: 'focus', motivation: ['Keep going'], blocklistSeeded: true })
    expect(data.backup).toEqual({ lastExportAt: 30, remindWeekly: true })
    expect(data.lastCelebratedLevel).toBe(3)
    expect((data.world as Record<string, unknown>).seed).toBe(42)
    expect(data.onboardedAt).toBe(100)
  })

  it('does not push a running or paused session, but does push it once it has ended', () => {
    const session = (status: string) => ({ id: 's1', status, kind: 'focus', day: '2026-10-01' })
    expect(toServerRow(entry('sessions', 's1'), session('running'), ctx)).toEqual({
      kind: 'drop',
      reason: 'inProgress',
    })
    expect(toServerRow(entry('sessions', 's1'), session('paused'), ctx)).toEqual({
      kind: 'drop',
      reason: 'inProgress',
    })
    for (const status of ['completed', 'abandoned']) {
      expect(toServerRow(entry('sessions', 's1'), session(status), ctx).kind).toBe('push')
    }
    // A session deleted while it ran is a tombstone, not a drop.
    expect(toServerRow(entry('sessions', 's1'), undefined, ctx).kind).toBe('push')
  })

  it('drops an entry for a table that does not sync', () => {
    const local = { id: 'x' }
    expect(toServerRow({ tbl: 'files' as SyncTableName, id: 'x', at: 1 }, local, ctx)).toEqual({
      kind: 'drop',
      reason: 'notSynced',
    })
  })

  it('replaces the bytes of a file inside a trash entry with a marker, also nested in a goal cascade', () => {
    const pdf = new Blob([new Uint8Array(1234)], { type: 'application/pdf' })
    const trash = {
      id: 'tr1',
      createdAt: 1,
      updatedAt: 1,
      entityTable: 'goals',
      entityId: 'g1',
      title: 'C779 · Web Development Foundations',
      expiresAt: 99,
      payload: {
        goals: [{ id: 'g1', title: 'C779' }],
        milestones: [{ id: 'm1', goalId: 'g1' }],
        resources: [{ id: 'r1', goalId: 'g1', fileId: 'f1' }],
        files: [{ id: 'f1', name: 'D278 guide.pdf', size: 1234, blob: pdf }],
      },
    }
    const d = toServerRow(entry('trash', 'tr1'), trash, ctx)
    expect(d.kind).toBe('push')
    if (d.kind !== 'push') return
    const data = d.row.data as typeof trash
    expect(data.payload.files[0]?.blob).toEqual({
      __blob: true,
      type: 'application/pdf',
      size: 1234,
    })
    expect(data.payload.goals).toEqual(trash.payload.goals)
    expect(JSON.parse(JSON.stringify(data))).toEqual(data)
    // The local row still holds its real bytes.
    expect(trash.payload.files[0]?.blob).toBe(pdf)
  })

  it('leaves a trash entry without files alone', () => {
    const trash = { id: 'tr2', entityTable: 'tasks', entityId: 't1', payload: { tasks: [task] } }
    const d = toServerRow(entry('trash', 'tr2'), trash, ctx)
    if (d.kind === 'push') expect(d.row.data).toEqual(trash)
  })
})

// ─── Outbox and batching ────────────────────────────────────────────────────

describe('the outbox', () => {
  const e = (tbl: SyncTableName, id: string, at: number): SyncOutboxEntry => ({ tbl, id, at })

  it('orders by stamp, then table and id, without changing the input', () => {
    const input = [e('tasks', 'b', 3), e('goals', 'g', 1), e('tasks', 'a', 3), e('units', 'u', 2)]
    const copy = [...input]
    expect(orderOutbox(input).map((x) => x.id)).toEqual(['g', 'u', 'a', 'b'])
    expect(input).toEqual(copy)
  })

  it('reads at most 200 entries, oldest first', () => {
    const many = Array.from({ length: 450 }, (_, i) => e('tasks', `t${i}`, 1_000 - i))
    const round = nextPushEntries(many)
    expect(round).toHaveLength(200)
    expect(round[0]?.at).toBe(551)
    expect(round.at(-1)?.at).toBe(750)
    expect(nextPushEntries(many, 3)).toHaveLength(3)
    expect(nextPushEntries(many, 0)).toEqual([])
    expect(nextPushEntries([], 200)).toEqual([])
  })

  it('removes an entry after a push only if it still carries the pushed stamp', () => {
    expect(isSettled(100, 100)).toBe(true)
    expect(isSettled(100, 101)).toBe(false) // edited during the request: stays queued
    expect(isSettled(100, undefined)).toBe(false)
  })
})

describe('batching', () => {
  const row = (id: string, chars: number, extra: Partial<PushRow> = {}): PushRow => ({
    tbl: 'tasks',
    id,
    updatedAt: 1,
    deviceId: SELF,
    deleted: false,
    schemaVersion: 3,
    data: { id, notes: 'x'.repeat(chars) },
    ...extra,
  })

  it('counts UTF-8 bytes', () => {
    expect(utf8Length('abc')).toBe(3)
    expect(utf8Length('é')).toBe(2)
    expect(utf8Length('✓')).toBe(3)
    expect(utf8Length('😀')).toBe(4)
    expect(utf8Length('')).toBe(0)
    expect(pushRowBytes(row('a', 10))).toBeGreaterThan(utf8Length(JSON.stringify(row('a', 10))))
    expect(pushRowBytes(row('e', 1_000, { data: { notes: 'é'.repeat(1_000) } }))).toBeGreaterThan(
      2_000,
    )
  })

  it('keeps small pushes in one batch and keeps the order', () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(`t${i}`, 100))
    const { batches, tooLarge } = batchRows(rows)
    expect(batches).toHaveLength(1)
    expect(batches[0]?.map((r) => r.id)).toEqual(rows.map((r) => r.id))
    expect(tooLarge).toEqual([])
    expect(batchRows([])).toEqual({ batches: [], tooLarge: [] })
  })

  it('cuts at about 1 MB', () => {
    const rows = Array.from({ length: 4 }, (_, i) => row(`t${i}`, 300_000))
    const { batches } = batchRows(rows)
    expect(batches.map((b) => b.length)).toEqual([3, 1])
    for (const batch of batches) {
      expect(batch.reduce((sum, r) => sum + pushRowBytes(r), 0)).toBeLessThanOrEqual(
        BATCH_MAX_BYTES,
      )
    }
  })

  it('sends a row bigger than a batch alone, and a row over 8 MB not at all', () => {
    const small1 = row('s1', 100)
    const big = row('big', 2_000_000)
    const small2 = row('s2', 100)
    const huge = row('huge', 8_100_000)
    const { batches, tooLarge } = batchRows([small1, big, huge, small2])
    expect(batches.map((b) => b.map((r) => r.id))).toEqual([['s1'], ['big'], ['s2']])
    expect(tooLarge.map((r) => r.id)).toEqual(['huge'])
  })

  it('never exceeds the limit except for a lone row, and never drops or reorders a row', () => {
    const rand = prng(11)
    for (let round = 0; round < 60; round += 1) {
      const rows = Array.from({ length: 40 }, (_, i) =>
        row(`t${i}`, Math.floor(rand() ** 3 * 150_000)),
      )
      const { batches, tooLarge } = batchRows(rows, { maxBytes: 200_000 })
      expect(tooLarge).toEqual([])
      expect(batches.flat().map((r) => r.id)).toEqual(rows.map((r) => r.id))
      for (const batch of batches) {
        const bytes = batch.reduce((sum, r) => sum + pushRowBytes(r), 0)
        if (batch.length > 1) expect(bytes).toBeLessThanOrEqual(200_000)
      }
    }
  })

  it('honours custom limits', () => {
    const rows = [row('a', 500), row('b', 500), row('c', 500)]
    const each = pushRowBytes(rows[0] as PushRow)
    expect(batchRows(rows, { maxBytes: each * 2 }).batches.map((b) => b.length)).toEqual([2, 1])
    expect(batchRows(rows, { maxRowBytes: each - 1 }).tooLarge).toHaveLength(3)
  })

  it('halves a refused batch until one row is left', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`t${i}`, 10))
    const halves = splitBatch(rows)
    expect(halves?.map((h) => h.map((r) => r.id))).toEqual([
      ['t0', 't1', 't2'],
      ['t3', 't4'],
    ])
    expect(splitBatch(rows.slice(0, 2))?.map((h) => h.length)).toEqual([1, 1])
    expect(splitBatch(rows.slice(0, 1))).toBeNull()
    expect(splitBatch([])).toBeNull()
    // Splitting to the end visits every row exactly once.
    const seen: string[] = []
    const walk = (batch: PushRow[]): void => {
      const parts = splitBatch(batch)
      if (parts === null) seen.push(...batch.map((r) => r.id))
      else parts.forEach(walk)
    }
    walk(rows)
    expect(seen).toEqual(rows.map((r) => r.id))
  })

  it('fits a keepalive flush only under 60 KB', () => {
    expect(fitsKeepalive([])).toBe(true)
    expect(fitsKeepalive([row('a', 1_000)])).toBe(true)
    expect(fitsKeepalive([row('a', KEEPALIVE_MAX_BYTES)])).toBe(false)
    const rows = Array.from({ length: 10 }, (_, i) => row(`t${i}`, 6_500))
    expect(fitsKeepalive(rows.slice(0, 5))).toBe(true)
    expect(fitsKeepalive(rows)).toBe(false)
  })
})

// ─── Pulling ────────────────────────────────────────────────────────────────

const server = (seq: number, over: Partial<ServerRow> = {}): ServerRow => ({
  tbl: 'tasks',
  id: `t${seq}`,
  updatedAt: 1_000 + seq,
  deviceId: LOW,
  deleted: false,
  schemaVersion: 3,
  data: { id: `t${seq}` },
  seq,
  ...over,
})

describe('advancePull', () => {
  it('moves the cursor to the highest seq and counts pages and rows', () => {
    const p0 = startPull(10, 500)
    const step = advancePull(p0, [server(11), server(12), server(15)], { limit: 3 })
    expect(step.progress).toEqual({ cursor: 15, maxSeenStamp: 1_015, pages: 1, rows: 3 })
    expect(step.done).toBe(false)
    expect(step.stalled).toBe(false)
    expect(step.rows.map((r) => r.seq)).toEqual([11, 12, 15])
    const last = advancePull(step.progress, [server(20)], { limit: 3 })
    expect(last.done).toBe(true)
    expect(last.progress).toEqual({ cursor: 20, maxSeenStamp: 1_020, pages: 2, rows: 4 })
  })

  it('a page of the default size is full at 500', () => {
    const page = Array.from({ length: PULL_PAGE_SIZE }, (_, i) => server(i + 1))
    expect(advancePull(startPull(0, 0), page).done).toBe(false)
    expect(advancePull(startPull(0, 0), page.slice(1)).done).toBe(true)
  })

  it('never moves the cursor back, and drops rows at or below it', () => {
    const step = advancePull(startPull(50, 0), [server(40), server(50), server(51)], { limit: 10 })
    expect(step.rows.map((r) => r.seq)).toEqual([51])
    expect(step.progress.cursor).toBe(51)
    const none = advancePull(startPull(50, 0), [server(10), server(20)], { limit: 10 })
    expect(none.progress.cursor).toBe(50)
    expect(none.rows).toEqual([])
    expect(none.done).toBe(true)
  })

  it('sorts a page that arrives out of order', () => {
    const step = advancePull(startPull(0, 0), [server(9), server(3), server(6)], { limit: 10 })
    expect(step.rows.map((r) => r.seq)).toEqual([3, 6, 9])
  })

  it('takes stamps into maxSeenStamp only up to the ceiling, and only upward', () => {
    const page = [
      server(1, { updatedAt: 900 }),
      server(2, { updatedAt: 5_000 }),
      server(3, { updatedAt: 10 ** 13 }),
    ]
    expect(
      advancePull(startPull(0, 0), page, { limit: 10, ceiling: 6_000 }).progress.maxSeenStamp,
    ).toBe(5_000)
    expect(
      advancePull(startPull(0, 7_000), page, { limit: 10, ceiling: 6_000 }).progress.maxSeenStamp,
    ).toBe(7_000)
    expect(advancePull(startPull(0, 0), page, { limit: 10 }).progress.maxSeenStamp).toBe(10 ** 13)
  })

  it('stops a server that answers a full page and moves nothing', () => {
    const stuck = advancePull(startPull(100, 0), [server(1), server(2)], { limit: 2 })
    expect(stuck.stalled).toBe(true)
    expect(stuck.done).toBe(false)
    expect(advancePull(startPull(0, 0), [], { limit: 500 })).toMatchObject({
      done: true,
      stalled: false,
    })
  })
})

describe('migrateRows', () => {
  const NOW = 1_800_000_000_000
  it('brings a v1 task up to v2 the way an upgrade does', () => {
    const v1 = {
      id: 't1',
      title: 'D278 · Scripting review',
      dueDate: '2026-10-05',
      dueTime: '18:00',
      estimateMinutes: 45,
      source: 'user',
    }
    const [v3] = migrateRows('tasks', [v1], 1, 3, NOW) as Record<string, unknown>[]
    expect(v3).toMatchObject({
      id: 't1',
      doDate: '2026-10-05',
      doTime: '18:00',
      dueDate: null,
      durationMinutes: 45,
      kind: 'task',
    })
    expect(v1.dueDate).toBe('2026-10-05')
  })

  it('takes the sync field out of a v2 settings row, and leaves a v3 row alone', () => {
    const v2 = settings({ sync: { enabled: false, url: null } })
    const [v3] = migrateRows('settings', [v2], 2, 3, NOW) as Record<string, unknown>[]
    expect(v3 && 'sync' in v3).toBe(false)
    expect(v3?.profile).toEqual({ name: 'Ana' })
    const current = settings()
    expect(migrateRows('settings', [current], 3, 3, NOW)).toEqual([current])
  })

  it('goes v1 to v3 in one call, and migrates a trash payload', () => {
    const trash = {
      id: 'tr1',
      entityTable: 'tasks',
      entityId: 't1',
      payload: { tasks: [{ id: 't1', dueDate: '2026-10-05', dueTime: null, source: 'user' }] },
    }
    const [out] = migrateRows('trash', [trash], 1, 3, NOW) as {
      payload: { tasks: Record<string, unknown>[] }
    }[]
    expect(out?.payload.tasks[0]).toMatchObject({ doDate: '2026-10-05', dueDate: null })
    const v1Settings = settings({ sync: { enabled: true } })
    const [s] = migrateRows('settings', [v1Settings], 1, 3, NOW) as Record<string, unknown>[]
    expect(s && 'sync' in s).toBe(false)
  })

  it('does nothing when the row is not older than the target', () => {
    const rows = [{ id: 'x', dueDate: '2026-10-05' }]
    expect(migrateRows('tasks', rows, 3, 3, NOW)).toEqual(rows)
    expect(migrateRows('tasks', rows, 2, 3, NOW)).toEqual(rows)
    expect(migrateRows('tasks', rows, 4, 3, NOW)).toEqual(rows)
    expect(migrateRows('tasks', [], 1, 3, NOW)).toEqual([])
  })
})

describe('applying a page', () => {
  const NOW = 1_800_000_000_000

  it('prepares a live row, a tombstone, invalid data and an unknown table', () => {
    expect(prepareRemoteRow(server(1), 3, NOW)).toEqual({
      kind: 'put',
      row: server(1),
      data: { id: 't1' },
    })
    const gone = server(2, { deleted: true, data: null })
    expect(prepareRemoteRow(gone, 3, NOW)).toEqual({ kind: 'delete', row: gone })
    for (const data of [null, 'x', 5, [1], { title: 'no id' }, { id: 7 }, { id: 'someone-else' }]) {
      expect(prepareRemoteRow(server(3, { data }), 3, NOW).kind, JSON.stringify(data)).toBe(
        'invalid',
      )
    }
    const alien = server(4, { tbl: 'gizmos' as SyncTableName })
    expect(prepareRemoteRow(alien, 3, NOW).kind).toBe('unknownTable')
    expect(prepareRemoteRow(server(5, { tbl: 'files' as SyncTableName }), 3, NOW).kind).toBe(
      'unknownTable',
    )
  })

  it('migrates an older row on the way in', () => {
    const v1 = server(1, {
      id: 't1',
      schemaVersion: 1,
      data: { id: 't1', dueDate: '2026-10-05', dueTime: null, source: 'user' },
    })
    const v = prepareRemoteRow(v1, 3, NOW)
    expect(v.kind).toBe('put')
    if (v.kind === 'put')
      expect(v.data).toMatchObject({ id: 't1', doDate: '2026-10-05', dueDate: null })
    const v2Settings = server(2, {
      tbl: 'settings',
      id: 'app',
      schemaVersion: 2,
      data: { id: 'app', profile: { name: 'Ana' }, sync: { enabled: true } },
    })
    const s = prepareRemoteRow(v2Settings, 3, NOW)
    expect(s.kind === 'put' && 'sync' in s.data).toBe(false)
  })

  it('finds a row from a newer schema, tombstones included', () => {
    const page = [server(1), server(2, { schemaVersion: 4 }), server(3)]
    expect(findNewerSchema(page, 3)?.seq).toBe(2)
    expect(findNewerSchema([server(1)], 3)).toBeUndefined()
    expect(
      findNewerSchema([server(1, { deleted: true, data: null, schemaVersion: 9 })], 3)?.seq,
    ).toBe(1)
  })

  it('stops a whole page that holds a newer row, and otherwise gives a verdict per row', () => {
    const stopped = classifyPage([server(1), server(2, { schemaVersion: 4 })], 3, NOW)
    expect(stopped).toEqual({ updateNeeded: true, verdicts: [] })
    const ok = classifyPage(
      [server(1), server(2, { deleted: true, data: null }), server(3, { data: null })],
      3,
      NOW,
    )
    expect(ok.updateNeeded).toBe(false)
    expect(ok.verdicts.map((v) => v.kind)).toEqual(['put', 'delete', 'invalid'])
  })
})

// ─── First sync ─────────────────────────────────────────────────────────────

describe('seedDuplicates', () => {
  const STARTERS = new Set(['30 min gaming', 'Coffee out', 'Order takeout'])
  const reward = (id: string, title: string, touched = false) => ({
    id,
    title,
    createdAt: 100,
    updatedAt: touched ? 250 : 100,
  })
  const onboarding = (id: string, title: string, over: Record<string, unknown> = {}) => ({
    id,
    title,
    source: 'onboarding',
    status: 'todo',
    createdAt: 100,
    updatedAt: 100,
    ...over,
  })
  const empty = { rewards: [], tasks: [], blocklist: [] }

  const remoteIndex = (
    rows: { tbl: string; id: string; data: Record<string, unknown>; deleted?: boolean }[],
  ) => {
    const index = emptySeedIndex()
    for (const r of rows) indexRemoteSeedRow(index, { deleted: false, ...r })
    return index
  }

  it('drops an untouched starter reward the account already has under another id', () => {
    const remote = remoteIndex([
      { tbl: 'rewards', id: 'r-remote', data: { id: 'r-remote', title: 'Coffee out' } },
    ])
    const local = {
      ...empty,
      rewards: [
        reward('r-local', 'Coffee out'),
        reward('r-touched', 'Coffee out', true),
        reward('r-other', '30 min gaming'),
        reward('r-custom', 'New keyboard'),
      ],
    }
    expect(seedDuplicates(local, remote, STARTERS, 11)).toEqual([{ tbl: 'rewards', id: 'r-local' }])
  })

  it('does not drop a reward under the very id the account has, nor a custom title', () => {
    const remote = remoteIndex([
      {
        tbl: 'rewards',
        id: 'starter-reward:1',
        data: { id: 'starter-reward:1', title: 'Coffee out' },
      },
      { tbl: 'rewards', id: 'r9', data: { id: 'r9', title: 'New keyboard' } },
    ])
    const local = {
      ...empty,
      rewards: [reward('starter-reward:1', 'Coffee out'), reward('r1', 'New keyboard')],
    }
    expect(seedDuplicates(local, remote, STARTERS, 11)).toEqual([])
  })

  it('drops an untouched onboarding task the account already has, only', () => {
    const remote = remoteIndex([
      {
        tbl: 'tasks',
        id: 'a',
        data: { id: 'a', title: 'Add your first course', source: 'onboarding' },
      },
      { tbl: 'tasks', id: 'b', data: { id: 'b', title: 'Plan your week', source: 'user' } },
    ])
    const local = {
      ...empty,
      tasks: [
        onboarding('t1', 'Add your first course'),
        onboarding('t2', 'Add your first course', { status: 'done' }),
        onboarding('t3', 'Add your first course', { status: 'doing' }),
        onboarding('t4', 'Add your first course', { updatedAt: 300 }),
        onboarding('t5', 'Plan your week'), // the account's one is the user's own, not a seed
        onboarding('t6', 'Something else'),
        onboarding('t7', 'Add your first course', { source: 'user' }),
      ],
    }
    expect(seedDuplicates(local, remote, STARTERS, 11)).toEqual([{ tbl: 'tasks', id: 't1' }])
  })

  it('drops a blocklist entry the account has under another id, by kind, domain and pattern', () => {
    const seeded = { createdAt: 100, updatedAt: 100 }
    const remote = remoteIndex([
      {
        tbl: 'blocklist',
        id: 'b-1',
        data: { id: 'b-1', kind: 'block', domain: 'instagram.com', pattern: null },
      },
      {
        tbl: 'blocklist',
        id: 'b-2',
        data: {
          id: 'b-2',
          kind: 'allow',
          domain: 'youtube.com',
          pattern: 'youtube.com/watch?v=abc',
        },
      },
    ])
    const local = {
      ...empty,
      blocklist: [
        { id: 'x-1', kind: 'block', domain: 'Instagram.com', pattern: null, ...seeded }, // same entry, another id
        { id: 'b-1', kind: 'block', domain: 'instagram.com', pattern: null, ...seeded }, // the very same row
        {
          id: 'x-2',
          kind: 'allow',
          domain: 'youtube.com',
          pattern: 'youtube.com/watch?v=abc',
          ...seeded,
        },
        {
          id: 'x-3',
          kind: 'allow',
          domain: 'youtube.com',
          pattern: 'youtube.com/watch?v=xyz',
          ...seeded,
        },
        {
          id: 'x-4',
          kind: 'block',
          domain: 'youtube.com',
          pattern: 'youtube.com/watch?v=abc',
          ...seeded,
        },
        { id: 'x-5', kind: 'block', domain: 'reddit.com', pattern: null, ...seeded },
      ],
    }
    expect(seedDuplicates(local, remote, STARTERS, 11).map((d) => d.id)).toEqual(['x-1', 'x-2'])
  })

  it('keeps a blocklist entry the person changed here, even when the account has the same one', () => {
    const remote = remoteIndex([
      {
        tbl: 'blocklist',
        id: 'b-1',
        data: { id: 'b-1', kind: 'block', domain: 'x.com', pattern: null },
      },
    ])
    const local = {
      ...empty,
      blocklist: [
        // Switched off a day after it was added: the person's own edit.
        {
          id: 'x-1',
          kind: 'block',
          domain: 'x.com',
          pattern: null,
          createdAt: 100,
          updatedAt: 86_400_100,
        },
        // Seeded with its `createdAt` spread by a few ms, never touched: a seed duplicate.
        {
          id: 'x-2',
          kind: 'block',
          domain: 'x.com',
          pattern: null,
          createdAt: 107,
          updatedAt: 100,
        },
      ],
    }
    expect(seedDuplicates(local, remote, STARTERS, 11).map((d) => d.id)).toEqual(['x-2'])
  })

  it('ignores tombstones and other tables when indexing, and finds nothing without an account', () => {
    const index = remoteIndex([
      { tbl: 'rewards', id: 'r1', data: { title: 'Coffee out' }, deleted: true },
      { tbl: 'goals', id: 'g1', data: { title: 'Coffee out' } },
    ])
    expect(index.rewardTitles.size).toBe(0)
    const local = { ...empty, rewards: [reward('r-local', 'Coffee out')] }
    expect(seedDuplicates(local, index, STARTERS, 11)).toEqual([])
    expect(seedDuplicates(local, emptySeedIndex(), STARTERS, 11)).toEqual([])
    indexRemoteSeedRow(index, { tbl: 'rewards', id: 'r1', deleted: false, data: null })
    expect(blockSignature('block', ' Reddit.com ', null)).toBe('block|reddit.com|')
  })
})

describe('planBootstrapQueue', () => {
  const remote = (entries: [string, RemoteIndexEntry][]) => new Map(entries)
  const at = (updatedAt: number, ...ids: string[]) =>
    ids.map((id) => ({ tbl: 'tasks' as SyncTableName, id, updatedAt }))
  const plan = (over: Partial<Parameters<typeof planBootstrapQueue>[0]>) =>
    planBootstrapQueue({
      self: SELF,
      local: [],
      queued: new Set(),
      remote: new Map(),
      identical: new Set(),
      ...over,
    })

  it("queues every local row the account lacks, with the row's updatedAt as its stamp", () => {
    const out = plan({ local: [...at(700, 't1'), ...at(300, 't2')] })
    expect(out).toEqual([
      { tbl: 'tasks', id: 't2', at: 300 },
      { tbl: 'tasks', id: 't1', at: 700 },
    ])
  })

  it("queues a row that beats the account's stamp and leaves the rest", () => {
    const out = plan({
      local: [...at(1_000, 'newer', 'older', 'tieHigh', 'tieLow', 'ours')],
      remote: remote([
        [rowKey('tasks', 'newer'), { at: 900, device: HIGH, deleted: false }],
        [rowKey('tasks', 'older'), { at: 1_100, device: LOW, deleted: false }],
        [rowKey('tasks', 'tieHigh'), { at: 1_000, device: HIGH, deleted: false }],
        [rowKey('tasks', 'tieLow'), { at: 1_000, device: LOW, deleted: false }],
        [rowKey('tasks', 'ours'), { at: 1_000, device: SELF, deleted: false }],
      ]),
    })
    expect(out.map((e) => e.id)).toEqual(['newer', 'tieLow'])
    expect(out.every((e) => e.at === 1_000)).toBe(true)
  })

  it('skips rows that already have an entry', () => {
    const out = plan({ local: at(5, 'a', 'b'), queued: new Set([rowKey('tasks', 'a')]) })
    expect(out.map((e) => e.id)).toEqual(['b'])
  })

  it("never queues a row that is identical to the account's, whatever its updatedAt says", () => {
    // An adopted row carries the writer's own updatedAt. It equals the stored stamp on a tie (and beats it
    // when the stored device id is the smaller one), and is above it when the writer's clock ran more than
    // five minutes ahead: the server stored the capped stamp.
    const tie = rowKey('tasks', 'tie')
    const ahead = rowKey('tasks', 'ahead')
    const accountRows = remote([
      [tie, { at: 1_000, device: LOW, deleted: false }],
      [ahead, { at: 1_000, device: HIGH, deleted: false }],
    ])
    const local = [
      { tbl: 'tasks' as SyncTableName, id: 'tie', updatedAt: 1_000 },
      { tbl: 'tasks' as SyncTableName, id: 'ahead', updatedAt: 1_000 + 20 * 60_000 },
    ]
    // Without the filter both would be sent back: that is the defect it prevents.
    expect(plan({ local, remote: accountRows }).map((e) => e.id)).toEqual(['tie', 'ahead'])
    expect(plan({ local, remote: accountRows, identical: new Set([tie, ahead]) })).toEqual([])
    expect(
      plan({ local, remote: accountRows, identical: new Set([tie]) }).map((e) => e.id),
    ).toEqual(['ahead'])
  })

  it('leaves a row out of the queue only when it is in `identical`, not just because the account has it', () => {
    const remoteRow = remote([[rowKey('tasks', 'a'), { at: 500, device: HIGH, deleted: false }]])
    expect(plan({ local: at(900, 'a'), remote: remoteRow }).map((e) => e.id)).toEqual(['a'])
    expect(
      plan({ local: at(900, 'a'), remote: remoteRow, identical: new Set([rowKey('tasks', 'a')]) }),
    ).toEqual([])
  })

  it('brings back a row the account deleted earlier than this device changed it, not one deleted later', () => {
    const out = plan({
      local: [...at(1_000, 'edited', 'stale')],
      remote: remote([
        [rowKey('tasks', 'edited'), { at: 800, device: HIGH, deleted: true }],
        [rowKey('tasks', 'stale'), { at: 1_200, device: HIGH, deleted: true }],
      ]),
    })
    expect(out.map((e) => e.id)).toEqual(['edited'])
  })

  it('queues the settings row only when the account has none', () => {
    const local = [{ tbl: 'settings' as SyncTableName, id: 'app', updatedAt: 9_999 }]
    expect(plan({ local })).toHaveLength(1)
    expect(
      plan({
        local,
        remote: remote([[rowKey('settings', 'app'), { at: 1, device: LOW, deleted: false }]]),
      }),
    ).toEqual([])
    // A tombstone is not "the account has settings".
    expect(
      plan({
        local,
        remote: remote([[rowKey('settings', 'app'), { at: 1, device: LOW, deleted: true }]]),
      }),
    ).toHaveLength(1)
  })

  it('never queues an xpEvents row the account already has, and queues the ones it lacks', () => {
    const local = [
      { tbl: 'xpEvents' as SyncTableName, id: 'xp:dailyGoal:2026-10-01#0', updatedAt: 9_999 },
      { tbl: 'xpEvents' as SyncTableName, id: 'xp:task:t7#0', updatedAt: 5 },
    ]
    const out = plan({
      local,
      remote: remote([
        [rowKey('xpEvents', 'xp:dailyGoal:2026-10-01#0'), { at: 1, device: LOW, deleted: false }],
      ]),
    })
    expect(out.map((e) => e.id)).toEqual(['xp:task:t7#0'])
  })

  it('returns nothing for an empty device', () => {
    expect(plan({})).toEqual([])
  })
})

describe('sameRow', () => {
  it('compares rows as JSON carries them: key order and undefined values do not matter', () => {
    const a = {
      id: 't1',
      title: 'C182 · Unit 3',
      tags: ['wgu', 'exam'],
      meta: { done: false, n: 2 },
    }
    const b = {
      meta: { n: 2, done: false },
      tags: ['wgu', 'exam'],
      title: 'C182 · Unit 3',
      id: 't1',
    }
    expect(sameRow(a, b)).toBe(true)
    expect(sameRow({ ...a, due: undefined }, a)).toBe(true)
    expect(sameRow(a, { ...a, due: undefined })).toBe(true)
    expect(sameRow(null, null)).toBe(true)
    expect(sameRow([], [])).toBe(true)
  })

  it('tells any difference in a value, a key, an array or a type', () => {
    const a = { id: 't1', title: 'D278', order: 2, tags: ['x', 'y'], note: null }
    expect(sameRow(a, { ...a, title: 'D278 ' })).toBe(false)
    expect(sameRow(a, { ...a, order: 3 })).toBe(false)
    expect(sameRow(a, { ...a, tags: ['y', 'x'] })).toBe(false)
    expect(sameRow(a, { ...a, tags: ['x'] })).toBe(false)
    expect(sameRow(a, { ...a, note: undefined })).toBe(false) // null is a value, absent is not
    expect(sameRow(a, { ...a, extra: 1 })).toBe(false)
    expect(sameRow({ ...a, extra: 1 }, a)).toBe(false)
    expect(sameRow({ v: 1 }, { v: '1' })).toBe(false)
    expect(sameRow({ v: [] }, { v: {} })).toBe(false)
    expect(sameRow({ v: {} }, { v: [] })).toBe(false)
    expect(sameRow(undefined, null)).toBe(false)
    expect(sameRow(a, null)).toBe(false)
    expect(sameRow(null, a)).toBe(false)
    expect(sameRow('a', 'b')).toBe(false)
  })

  it('does not take a Blob or a Date for a plain object', () => {
    const blob = new Blob(['pdf'])
    expect(sameRow({ file: blob }, { file: { __blob: true } })).toBe(false)
    expect(sameRow({ file: blob }, { file: {} })).toBe(false)
    expect(sameRow({ file: blob }, { file: blob })).toBe(true) // the same object
    expect(sameRow({ at: new Date(5) }, { at: new Date(5) })).toBe(false)
  })
})

describe('noteIdenticalRow', () => {
  const put = (tbl: SyncTableName, data: Record<string, unknown>): RowVerdict => {
    const id = String(data.id)
    return { kind: 'put', row: server(1, { tbl, id, data }), data }
  }

  it('adds a live row whose local copy equals the account, and takes a changed one out again', () => {
    const identical = new Set<string>()
    const data = { id: 't1', title: 'C779 · Web Development' }
    noteIdenticalRow(identical, put('tasks', data), { ...data })
    expect([...identical]).toEqual([rowKey('tasks', 't1')])
    noteIdenticalRow(identical, put('tasks', data), { ...data, title: 'edited here' })
    expect(identical.size).toBe(0)
  })

  it('is not identical when nothing is local, for a tombstone, an invalid row or an unknown table', () => {
    const identical = new Set<string>([rowKey('tasks', 't1'), rowKey('tasks', 't2')])
    const data = { id: 't1' }
    noteIdenticalRow(identical, put('tasks', data), undefined)
    expect(identical.has(rowKey('tasks', 't1'))).toBe(false)
    const row = server(2, { id: 't2', deleted: true, data: null })
    noteIdenticalRow(identical, { kind: 'delete', row }, { id: 't2' })
    expect(identical.size).toBe(0)
    noteIdenticalRow(identical, { kind: 'invalid', row: server(3) }, { id: 't3' })
    noteIdenticalRow(identical, { kind: 'unknownTable', row: server(4) }, { id: 't4' })
    expect(identical.size).toBe(0)
  })

  it('never counts the settings row: its device-only fields differ by design', () => {
    const identical = new Set<string>()
    const data = { id: 'app', profile: { name: 'Ana' } }
    noteIdenticalRow(identical, put('settings', data), { ...data })
    expect(identical.size).toBe(0)
  })

  it("the last row seen for a key decides, so a key the account changed mid-pull is not 'identical'", () => {
    const identical = new Set<string>()
    const first = { id: 't1', title: 'v1' }
    noteIdenticalRow(identical, put('tasks', first), { ...first })
    expect(identical.size).toBe(1)
    const second = { id: 't1', title: 'v2' }
    noteIdenticalRow(identical, put('tasks', second), { ...first }) // skipped: this device's row is newer
    expect(identical.size).toBe(0)
  })
})
