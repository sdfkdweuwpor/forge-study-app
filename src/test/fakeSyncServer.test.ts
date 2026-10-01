import { describe, expect, it } from 'vitest'
import { SyncTransportError, type PushRow } from '@/logic/sync'
import { FakeSyncServer, offlineError, serverError } from './fakeSyncServer'

const row = (id: string, at: number, over: Partial<PushRow> = {}): PushRow => ({
  tbl: 'tasks',
  id,
  updatedAt: at,
  deviceId: 'device-a',
  deleted: false,
  schemaVersion: 3,
  data: { id, title: `C182 · ${id}` },
  ...over,
})

describe('FakeSyncServer', () => {
  it('stores pushed rows and serves them by seq, like the real table', async () => {
    const server = new FakeSyncServer()
    await server.push([row('a', 1000), row('b', 1001)])
    const page = await server.pull(0, 500)
    expect(page.map((r) => r.id)).toEqual(['a', 'b'])
    expect(await server.pull(page[0]?.seq ?? 0, 500)).toHaveLength(1)
    expect(server.row('tasks', 'a')?.data).toMatchObject({ title: 'C182 · a' })
  })

  it('advances its clock by at least a millisecond per call, even when the base clock stands still', async () => {
    const server = new FakeSyncServer({ clock: () => 5_000 })
    const a = await server.serverTime()
    const b = await server.serverTime()
    const c = await server.serverTime()
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })

  it('runs ahead of or behind the test clock with clockOffsetMs', async () => {
    const server = new FakeSyncServer({ clock: () => 10_000 })
    server.clockOffsetMs = -4_000
    expect(await server.serverTime()).toBe(6_000)
  })

  it('fails every call while offline, and only the asked calls with failNext', async () => {
    const server = new FakeSyncServer()
    server.offline = true
    await expect(server.pull(0, 10)).rejects.toMatchObject({ kind: 'offline' })
    server.calm()
    server.failNext(2, serverError(503), 'push')
    await expect(server.push([row('a', 1)])).rejects.toMatchObject({ kind: 'server', status: 503 })
    await expect(server.pull(0, 10)).resolves.toEqual([])
    await expect(server.push([row('a', 1)])).rejects.toBeInstanceOf(SyncTransportError)
    await server.push([row('a', 1)])
    expect(server.rows()).toHaveLength(1)
  })

  it('a lost answer stores the rows and then fails', async () => {
    const server = new FakeSyncServer()
    server.loseAnswerNext()
    await expect(server.push([row('a', 1)])).rejects.toEqual(offlineError())
    expect(server.rows()).toHaveLength(1)
    await server.push([row('a', 1)])
    expect(server.rows()).toHaveLength(1)
  })

  it('answers 413 over a size and 400 for a refused row, storing nothing', async () => {
    const server = new FakeSyncServer()
    server.maxPushBytes = 200
    await expect(
      server.push(Array.from({ length: 10 }, (_v, i) => row(`t${i}`, i + 1))),
    ).rejects.toMatchObject({ kind: 'tooLarge', status: 413 })
    server.calm()
    server.refuseRow = (r) => r.id === 'bad'
    await expect(server.push([row('ok', 1), row('bad', 2)])).rejects.toMatchObject({ status: 400 })
    expect(server.rows()).toHaveLength(0)
  })

  it('keeps accounts apart on one cloud', async () => {
    const ana = new FakeSyncServer()
    const ben = ana.forAccount('another-account')
    await ana.push([row('a', 1)])
    expect(await ben.pull(0, 10)).toEqual([])
    await ben.push([row('b', 2)])
    expect(ana.rows().map((r) => r.id)).toEqual(['a'])
    expect(ben.rows().map((r) => r.id)).toEqual(['b'])
  })

  it('counts calls by kind', async () => {
    const server = new FakeSyncServer()
    await server.serverTime()
    await server.push([row('a', 1)])
    await server.pull(0, 10)
    await server.pull(0, 10)
    expect([server.count('serverTime'), server.count('push'), server.count('pull')]).toEqual([
      1, 1, 2,
    ])
  })
})
