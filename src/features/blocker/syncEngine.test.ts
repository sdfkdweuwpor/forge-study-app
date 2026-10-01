import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockerConfig, SessionState } from '@ext/protocol'
import type { BridgeResult, EventsReply, ExtensionInfo } from './bridge'
import { createSyncEngine, type SyncDeps } from './syncEngine'

const CONFIG: BlockerConfig = {
  mode: 'focus',
  blocklist: ['instagram.com', 'youtube.com'],
  allowlist: [],
  schedule: [],
  motivation: ['One unit at a time.'],
}
const SESSION: SessionState = { active: true, endsAt: 9_000, taskTitle: 'Read chapter 4' }

const ok = <T>(value: T): BridgeResult<T> => ({ ok: true, value })
const gone: BridgeResult<never> = { ok: false, reason: 'no-runtime', message: 'no extension' }

interface Fake {
  deps: SyncDeps
  log: string[]
  /** What the extension does next; set `absent` to simulate it not being installed. */
  extension: { absent: boolean; events: EventsReply; version: string }
  stored: EventsReply[]
  cursor: { value: number }
  status: string[]
  errors: string[]
}

function fake(): Fake {
  const log: string[] = []
  const state: Fake = {
    log,
    extension: { absent: false, events: { events: [], cursor: 0 }, version: '1.0.0' },
    stored: [],
    cursor: { value: 0 },
    status: [],
    errors: [],
    deps: undefined as unknown as SyncDeps,
  }
  const reply = <T>(value: T): Promise<BridgeResult<T>> =>
    Promise.resolve(state.extension.absent ? gone : ok(value))
  state.deps = {
    ping: () => {
      log.push('ping')
      return reply<ExtensionInfo>({ version: state.extension.version })
    },
    pushConfig: (config) => {
      log.push(`config:${config.blocklist.length}`)
      return reply(null)
    },
    pushSession: (session) => {
      log.push(`session:${session === null ? 'null' : session.taskTitle}`)
      return reply(null)
    },
    pullEvents: (since) => {
      log.push(`pull:${since}`)
      return reply(state.extension.events)
    },
    readCursor: () => Promise.resolve(state.cursor.value),
    storeEvents: (r) => {
      state.stored.push(r)
      state.cursor.value = r.cursor
      return Promise.resolve()
    },
    markSynced: () => {
      log.push('synced')
      return Promise.resolve()
    },
    now: () => 1_000,
    setConnected: (version) => void state.status.push(`connected:${version}`),
    setUnavailable: (reason) => void state.status.push(`unavailable:${reason}`),
    report: (e, detail) =>
      void state.errors.push(`${detail}:${e instanceof Error ? e.message : String(e)}`),
  }
  return state
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('pushing', () => {
  it('a burst of config changes is one push, after the debounce', async () => {
    const f = fake()
    const engine = createSyncEngine(f.deps)
    await engine.pull() // first contact
    f.log.length = 0
    engine.setConfig({ ...CONFIG, blocklist: ['a.com'] })
    engine.setConfig({ ...CONFIG, blocklist: ['a.com', 'b.com'] })
    engine.setConfig(CONFIG)
    await vi.advanceTimersByTimeAsync(399)
    expect(f.log).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(f.log).toEqual(['config:2', 'synced'])
  })

  it('does not push a config the extension already has', async () => {
    const f = fake()
    const engine = createSyncEngine(f.deps)
    engine.setConfig(CONFIG)
    await engine.pull()
    f.log.length = 0
    engine.setConfig({ ...CONFIG })
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.log).toEqual([])
    engine.setConfig({ ...CONFIG, mode: 'always' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.log).toEqual(['config:2', 'synced'])
  })

  it('pushes the session on start, pause and end, faster than the config', async () => {
    const f = fake()
    const engine = createSyncEngine(f.deps)
    engine.setSession(null)
    await engine.pull()
    f.log.length = 0
    engine.setSession(SESSION)
    await vi.advanceTimersByTimeAsync(120)
    engine.setSession({ ...SESSION, endsAt: null }) // paused
    await vi.advanceTimersByTimeAsync(120)
    engine.setSession(null)
    await vi.advanceTimersByTimeAsync(120)
    expect(f.log).toEqual(['session:Read chapter 4', 'session:Read chapter 4', 'session:null'])
  })

  it('an unknown session is not pushed as "no session"', async () => {
    const f = fake()
    const engine = createSyncEngine(f.deps)
    engine.setConfig(CONFIG)
    await engine.pull()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.log.filter((l) => l.startsWith('session'))).toEqual([])
  })

  it('nothing is pushed until a config is known', async () => {
    const f = fake()
    const engine = createSyncEngine(f.deps)
    engine.setConfig(null)
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.log).toEqual([])
  })
})

describe('the extension is absent', () => {
  it('is silent: a status, no errors, nothing thrown', async () => {
    const f = fake()
    f.extension.absent = true
    const engine = createSyncEngine(f.deps)
    engine.setConfig(CONFIG)
    engine.setSession(SESSION)
    await engine.pull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.errors).toEqual([])
    expect(f.status.every((s) => s === 'unavailable:no-runtime')).toBe(true)
    expect(f.log.every((l) => l === 'ping')).toBe(true)
    expect(f.stored).toEqual([])
  })

  it('a push that fails marks the extension unreachable and stops', async () => {
    const f = fake()
    const engine = createSyncEngine(f.deps)
    engine.setConfig(CONFIG)
    await engine.pull()
    f.log.length = 0
    f.status.length = 0
    f.extension.absent = true
    engine.setConfig({ ...CONFIG, mode: 'always' })
    await vi.advanceTimersByTimeAsync(400)
    expect(f.status).toEqual(['unavailable:no-runtime'])
  })

  it('pushes everything again as soon as the extension shows up', async () => {
    const f = fake()
    f.extension.absent = true
    const engine = createSyncEngine(f.deps)
    engine.setConfig(CONFIG)
    engine.setSession(SESSION)
    await engine.pull()
    await vi.advanceTimersByTimeAsync(1000)
    f.log.length = 0
    f.extension.absent = false
    await engine.pull()
    expect(f.log).toEqual(['ping', 'config:2', 'synced', 'session:Read chapter 4', 'pull:0'])
  })

  it('a config change while unavailable pings instead of blindly pushing, and pushes once it is back', async () => {
    const f = fake()
    f.extension.absent = true
    const engine = createSyncEngine(f.deps)
    await engine.pull()
    f.extension.absent = false
    f.log.length = 0
    engine.setConfig(CONFIG)
    await vi.advanceTimersByTimeAsync(400)
    expect(f.log).toEqual(['ping', 'config:2', 'synced'])
  })

  it('re-pushes after contact is lost and regained, since the extension may have been reinstalled', async () => {
    const f = fake()
    const engine = createSyncEngine(f.deps)
    engine.setConfig(CONFIG)
    await engine.pull()
    f.extension.absent = true
    await engine.pull()
    f.extension.absent = false
    f.log.length = 0
    await engine.pull()
    expect(f.log).toContain('config:2')
  })
})

describe('pulling events', () => {
  it('reads from the stored cursor, stores the events and moves the cursor', async () => {
    const f = fake()
    f.cursor.value = 100
    f.extension.events = {
      events: [{ id: 'a', at: 150, kind: 'blocked', domain: 'reddit.com' }],
      cursor: 150,
    }
    const engine = createSyncEngine(f.deps)
    await engine.pull()
    expect(f.log).toContain('pull:100')
    expect(f.stored).toEqual([f.extension.events])
    f.log.length = 0
    await engine.pull()
    expect(f.log).toContain('pull:150')
  })

  it('reports the version of the extension it found', async () => {
    const f = fake()
    f.extension.version = '1.2.3'
    await createSyncEngine(f.deps).pull()
    expect(f.status).toEqual(['connected:1.2.3'])
  })

  it('check pings and pushes but does not pull', async () => {
    const f = fake()
    const engine = createSyncEngine(f.deps)
    engine.setConfig(CONFIG)
    await engine.check()
    expect(f.log).toEqual(['ping', 'config:2', 'synced'])
  })

  it('a database error is reported, not thrown, and the next pull still runs', async () => {
    const f = fake()
    let fail = true
    const deps: SyncDeps = {
      ...f.deps,
      storeEvents: () => {
        if (fail) return Promise.reject(new Error('disk full'))
        return Promise.resolve()
      },
    }
    const engine = createSyncEngine(deps)
    await expect(engine.pull()).resolves.toBeUndefined()
    expect(f.errors).toEqual(['blocker.pull:disk full'])
    fail = false
    await expect(engine.pull()).resolves.toBeUndefined()
    expect(f.errors).toHaveLength(1)
  })

  it('a failed markSynced does not stop the sync', async () => {
    const f = fake()
    const engine = createSyncEngine({
      ...f.deps,
      markSynced: () => Promise.reject(new Error('locked')),
    })
    engine.setConfig(CONFIG)
    await engine.pull()
    expect(f.errors).toEqual(['blocker.markSynced:locked'])
    expect(f.log).toContain('pull:0')
  })

  it('calls run one at a time, in order', async () => {
    const f = fake()
    const order: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const engine = createSyncEngine({
      ...f.deps,
      ping: async () => {
        order.push('ping:start')
        await gate
        order.push('ping:end')
        return ok({ version: '1' })
      },
    })
    const first = engine.pull()
    const second = engine.pull()
    await vi.advanceTimersByTimeAsync(10)
    expect(order).toEqual(['ping:start'])
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['ping:start', 'ping:end', 'ping:start', 'ping:end'])
  })
})

describe('cancelPending', () => {
  it('drops scheduled pushes; the next set schedules them again', async () => {
    const f = fake()
    const engine = createSyncEngine(f.deps)
    await engine.pull()
    f.log.length = 0
    engine.setConfig(CONFIG)
    engine.cancelPending()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.log).toEqual([])
    engine.setConfig(CONFIG)
    await vi.advanceTimersByTimeAsync(400)
    expect(f.log).toEqual(['config:2', 'synced'])
  })
})
