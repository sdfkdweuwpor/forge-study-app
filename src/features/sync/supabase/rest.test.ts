import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncSession } from '@/db/types'
import { needsRefresh, SyncTransportError, type PushRow } from '@/logic/sync'
import type { TransportConfig } from '@/logic/syncRequests'
import { refreshSession } from './auth'
import { createHttp, SupabaseError, type FetchLike } from './http'
import { createSyncServer, fetchServerTime, pullRows, pushRows } from './rest'

const KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl'
const config: TransportConfig = {
  url: 'https://abcdefghijklmnopqrst.supabase.co',
  anonKey: KEY,
  keyKind: 'anonJwt',
}
const USER = 'user-0001'
const session = { accessToken: 'access-1', userId: USER }

afterEach(() => vi.useRealTimers())

interface Stored {
  user_id: string
  tbl: string
  id: string
  updated_at: number
  device_id: string
  deleted: boolean
  schema_version: number
  data: unknown
  seq: number
}
interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
  keepalive: boolean
}

const reply = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status })

/**
 * A stand-in for the person's project, at the level of HTTP: the PostgREST rules the design relies on
 * (bulk upsert needs identical keys, RLS on `user_id`, `seq` in commit order, the trigger's last-write-wins
 * with a device-id tie-break and its 5 minute clamp), and a token endpoint for the refresh test.
 */
function project() {
  const rows = new Map<string, Stored>()
  const calls: Call[] = []
  const tokens = new Map<string, string>([['access-1', USER]])
  const state = {
    seq: 0,
    now: 1_780_000_000_000,
    tableMissing: false,
    /** Run after the server applied a push but before its answer is sent. */
    afterApply: null as null | (() => Response | Promise<Response>),
    /** Fail the next calls with this response, before any effect. */
    failNext: [] as Response[],
    refreshed: 0,
  }

  const handle = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = init.headers as Record<string, string>
    calls.push({
      method: String(init.method),
      url,
      headers,
      body: typeof init.body === 'string' ? init.body : null,
      keepalive: init.keepalive === true,
    })
    const failure = state.failNext.shift()
    if (failure !== undefined) return failure
    const u = new URL(url)
    if (u.pathname === '/auth/v1/token') {
      state.refreshed++
      const token = `access-${state.refreshed + 1}`
      tokens.set(token, USER)
      return reply(200, {
        access_token: token,
        refresh_token: `refresh-${state.refreshed + 1}`,
        expires_in: 3600,
        user: { id: USER, email: 'ana@example.com' },
      })
    }
    const user = tokens.get((headers.Authorization ?? '').replace('Bearer ', ''))
    if (user === undefined) return reply(401, { code: 'PGRST301', message: 'JWT expired' })
    if (state.tableMissing) return reply(404, { code: 'PGRST205', message: 'no table' })
    if (u.pathname === '/rest/v1/rpc/forge_now') return reply(200, state.now)
    if (u.pathname !== '/rest/v1/forge_rows') return reply(404)

    if (init.method === 'GET') {
      const after = Number((u.searchParams.get('seq') ?? '').replace('gt.', ''))
      const limit = Number(u.searchParams.get('limit'))
      const columns = (u.searchParams.get('select') ?? '').split(',')
      const page = [...rows.values()]
        .filter((r) => r.user_id === user && r.seq > after)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit)
        .map((r) => Object.fromEntries(columns.map((c) => [c, r[c as keyof Stored]])))
      return reply(200, page)
    }

    if (u.searchParams.get('on_conflict') !== 'user_id,tbl,id') return reply(409, { code: '23505' })
    if (!(headers.Prefer ?? '').includes('resolution=merge-duplicates')) return reply(409)
    const batch = JSON.parse(String(init.body)) as Omit<Stored, 'seq'>[]
    const shape = Object.keys(batch[0] ?? {}).join()
    if (batch.some((r) => Object.keys(r).join() !== shape)) {
      return reply(400, { code: 'PGRST102', message: 'All object keys must match' })
    }
    if (batch.some((r) => r.user_id !== user)) return reply(403, { code: '42501' })
    for (const r of batch) {
      const key = `${r.user_id}|${r.tbl}|${r.id}`
      const old = rows.get(key)
      const stamp = Math.min(r.updated_at, state.now + 300_000)
      if (old !== undefined) {
        if (stamp < old.updated_at) continue
        if (stamp === old.updated_at && r.device_id < old.device_id) continue
      }
      rows.set(key, { ...r, updated_at: stamp, data: r.deleted ? null : r.data, seq: ++state.seq })
    }
    return state.afterApply !== null ? state.afterApply() : reply(201)
  }

  const fetchLike: FetchLike = (url, init) => handle(url, init)
  return { rows, calls, tokens, state, fetch: fetchLike }
}

const row = (n: number, over: Partial<PushRow> = {}): PushRow => ({
  tbl: 'tasks',
  id: `task-${n}`,
  updatedAt: 1_780_000_000_000 + n,
  deviceId: 'device-a',
  deleted: false,
  schemaVersion: 3,
  data: { id: `task-${n}`, title: `Study C${n} unit ${n}` },
  ...over,
})

describe('pushRows and pullRows', () => {
  it('round-trips rows in seq order, camel-cased', async () => {
    const p = project()
    const send = createHttp({ fetch: p.fetch })
    await pushRows(send, config, session, [row(1), row(2), row(3, { deleted: true, data: null })])
    const page = await pullRows(send, config, session, 0, 500)
    expect(page.map((r) => r.id)).toEqual(['task-1', 'task-2', 'task-3'])
    expect(page.map((r) => r.seq)).toEqual([1, 2, 3])
    expect(page[0]).toEqual({ ...row(1), seq: 1 })
    expect(page[2]).toMatchObject({ deleted: true, data: null })
    expect(await pullRows(send, config, session, 3, 500)).toEqual([])
  })

  it('pages through a large account by cursor', async () => {
    const p = project()
    const send = createHttp({ fetch: p.fetch })
    const all = Array.from({ length: 1_200 }, (_, i) => row(i))
    for (let i = 0; i < all.length; i += 500)
      await pushRows(send, config, session, all.slice(i, i + 500))
    const ids: string[] = []
    let cursor = 0
    for (;;) {
      const page = await pullRows(send, config, session, cursor, 500)
      ids.push(...page.map((r) => r.id))
      if (page.length < 500) break
      cursor = page[page.length - 1]?.seq ?? cursor
    }
    expect(ids).toEqual(all.map((r) => r.id))
  })

  it('sends nothing for an empty batch', async () => {
    const p = project()
    await pushRows(createHttp({ fetch: p.fetch }), config, session, [])
    expect(p.calls).toHaveLength(0)
  })

  it('sends a keepalive push for the flush on hide', async () => {
    const p = project()
    await pushRows(createHttp({ fetch: p.fetch }), config, session, [row(1)], { keepalive: true })
    expect(p.calls[0]?.keepalive).toBe(true)
    expect(p.rows.size).toBe(1)
  })

  it('is accepted by a server that enforces the bulk-upsert rules', async () => {
    // Rows whose data is undefined, null, or a tombstone all still make objects with the same keys.
    const p = project()
    await pushRows(createHttp({ fetch: p.fetch }), config, session, [
      row(1),
      row(2, { data: undefined, deleted: true }),
      row(3, { deleted: true, data: null }),
    ])
    expect(p.rows.size).toBe(3)
  })

  it('lets the server keep a newer row: an older push changes nothing', async () => {
    const p = project()
    const send = createHttp({ fetch: p.fetch })
    await pushRows(send, config, session, [row(1, { updatedAt: 2_000, deviceId: 'device-b' })])
    await pushRows(send, config, session, [row(1, { updatedAt: 1_000, deviceId: 'device-a' })])
    const [only] = await pullRows(send, config, session, 0, 500)
    expect(only).toMatchObject({ updatedAt: 2_000, deviceId: 'device-b' })
  })
})

describe('a retried push is idempotent', () => {
  const rows = [row(1), row(2), row(3, { deleted: true, data: null })]

  const snapshot = (p: ReturnType<typeof project>) =>
    JSON.stringify([...p.rows.entries()].map(([k, r]) => [k, { ...r, seq: 0 }]).sort())

  it('after an answer that was lost (the server applied it, the client timed out)', async () => {
    vi.useFakeTimers()
    const p = project()
    p.state.afterApply = () => new Promise<Response>(() => undefined)
    // Like the real fetch, this one rejects when the client's timeout aborts it.
    const lossy: FetchLike = (url, init) =>
      new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
        p.fetch(url, init).then(resolve, reject)
      })
    const first = pushRows(createHttp({ fetch: lossy }), config, session, rows).catch(
      (e: unknown) => e,
    )
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await first).toMatchObject({ reason: 'unavailable', kind: 'server' })
    expect(p.rows.size).toBe(3)
    const afterFirst = snapshot(p)

    p.state.afterApply = null
    await pushRows(createHttp({ fetch: p.fetch }), config, session, rows)
    expect(p.calls).toHaveLength(2)
    expect(p.calls[1]).toEqual(p.calls[0])
    expect(snapshot(p)).toBe(afterFirst)
    expect(p.rows.size).toBe(3)
  })

  it('after a 503 that arrived before the server did anything', async () => {
    const p = project()
    p.state.failNext = [reply(503)]
    const send = createHttp({ fetch: p.fetch })
    const error = await pushRows(send, config, session, rows).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SupabaseError)
    expect(p.rows.size).toBe(0)
    await pushRows(send, config, session, rows)
    expect(p.rows.size).toBe(3)
    expect(p.calls[1]).toEqual(p.calls[0])
  })

  it('however many times it is sent, the same rows result', async () => {
    const p = project()
    const send = createHttp({ fetch: p.fetch })
    await pushRows(send, config, session, rows)
    const once = snapshot(p)
    for (let i = 0; i < 3; i++) await pushRows(send, config, session, rows)
    expect(snapshot(p)).toBe(once)
    expect(p.calls.every((c) => c.body === p.calls[0]?.body && c.url === p.calls[0]?.url)).toBe(
      true,
    )
  })

  it('does not undo a newer write that landed in between', async () => {
    const p = project()
    const send = createHttp({ fetch: p.fetch })
    await pushRows(send, config, session, rows)
    // Another device wins on row 1 while our answer was lost.
    await pushRows(send, config, session, [
      row(1, { updatedAt: 9_999_999_999_999, deviceId: 'device-b' }),
    ])
    await pushRows(send, config, session, rows)
    const page = await pullRows(send, config, session, 0, 500)
    expect(page.find((r) => r.id === 'task-1')?.deviceId).toBe('device-b')
  })
})

describe('serverTime', () => {
  it('reads forge_now', async () => {
    const p = project()
    expect(await fetchServerTime(createHttp({ fetch: p.fetch }), config, session)).toBe(p.state.now)
  })

  it('rejects an answer that is not a number', async () => {
    const send = createHttp({ fetch: () => Promise.resolve(reply(200, { now: 1 })) })
    await expect(fetchServerTime(send, config, session)).rejects.toMatchObject({
      reason: 'rejected',
      kind: 'server',
    })
  })

  it('reports a missing forge_now as setup', async () => {
    const send = createHttp({
      fetch: () => Promise.resolve(reply(404, { code: 'PGRST202', message: 'x' })),
    })
    await expect(fetchServerTime(send, config, session)).rejects.toMatchObject({ kind: 'setup' })
  })
})

describe('failures through the data calls', () => {
  it('pull: a page that is not a list of rows is rejected, and never moves a cursor', async () => {
    for (const body of [{}, 'x', [{ id: 'a' }], null]) {
      const send = createHttp({ fetch: () => Promise.resolve(reply(200, body)) })
      await expect(pullRows(send, config, session, 0, 500)).rejects.toMatchObject({
        reason: 'rejected',
      })
    }
  })

  it('maps a missing table, missing policies and an expired token', async () => {
    const p = project()
    const send = createHttp({ fetch: p.fetch })
    p.state.tableMissing = true
    await expect(pullRows(send, config, session, 0, 500)).rejects.toMatchObject({
      reason: 'setup',
      kind: 'setup',
    })
    p.state.tableMissing = false
    await expect(
      pullRows(send, config, { ...session, accessToken: 'stale' }, 0, 500),
    ).rejects.toMatchObject({ reason: 'unauthorized', kind: 'signedOut', status: 401 })
    p.state.failNext = [reply(403, { code: '42501', message: 'x' })]
    await expect(pushRows(send, config, session, [row(1)])).rejects.toMatchObject({
      reason: 'forbidden',
      kind: 'forbidden',
    })
  })
})

describe('createSyncServer', () => {
  it('is a SyncServer: push, pull and serverTime', async () => {
    const p = project()
    const server = createSyncServer(createHttp({ fetch: p.fetch }), config, () => session)
    await server.push([row(1), row(2)])
    expect((await server.pull(0, 500)).map((r) => r.id)).toEqual(['task-1', 'task-2'])
    expect(await server.serverTime()).toBe(p.state.now)
  })

  it('reads the session on every call, so a refreshed token is used at once', async () => {
    const p = project()
    p.tokens.set('access-9', USER)
    let current: { accessToken: string; userId: string } = session
    const server = createSyncServer(createHttp({ fetch: p.fetch }), config, () => current)
    await server.push([row(1)])
    current = { accessToken: 'access-9', userId: USER }
    await server.push([row(2)])
    expect(p.calls.map((c) => c.headers.Authorization)).toEqual([
      'Bearer access-1',
      'Bearer access-9',
    ])
  })

  it('throws SyncTransportError, whatever goes wrong', async () => {
    const p = project()
    const server = createSyncServer(createHttp({ fetch: p.fetch }), config, () => session)
    p.state.failNext = [reply(429), reply(500), reply(413)]
    for (const kind of ['rateLimited', 'server', 'tooLarge']) {
      const error = await server.push([row(1)]).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(SyncTransportError)
      expect((error as SyncTransportError).kind).toBe(kind)
    }
  })
})

describe('expired token, refresh, retry (the engine flow this transport is built for)', () => {
  it('answers 401, refreshes once, and the retry succeeds with the new token', async () => {
    const p = project()
    const send = createHttp({ fetch: p.fetch })
    let current: SyncSession = {
      accessToken: 'expired',
      refreshToken: 'refresh-1',
      expiresAt: 0,
      userId: USER,
      email: 'ana@example.com',
    }
    const server = createSyncServer(send, config, () => current)

    const first = await server.push([row(1)]).catch((e: unknown) => e)
    expect(first).toMatchObject({ kind: 'signedOut', status: 401 })
    expect(needsRefresh((first as SyncTransportError).status, false)).toBe(true)

    current = await refreshSession(send, config, current, 1_780_000_000_000)
    expect(current.accessToken).toBe('access-2')
    expect(current.refreshToken).toBe('refresh-2')
    await server.push([row(1)])
    expect(p.rows.size).toBe(1)

    const refreshCall = p.calls.find((c) => c.url.includes('grant_type=refresh_token'))
    expect(refreshCall?.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(refreshCall?.body).toBe(JSON.stringify({ refresh_token: 'refresh-1' }))
  })
})
