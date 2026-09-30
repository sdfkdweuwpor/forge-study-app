import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDLE_ENGINE, getEngineState, setEngineState, subscribeEngineState } from './engineState'
import { LOCK_NAME, createLeader, readMessage, type LockApi } from './leader'

/**
 * The part of Web Locks election uses, for one name: the first request holds the lock until its callback
 * settles; later ones wait in order (or get `null` with `ifAvailable`); an aborted wait rejects.
 */
class FakeLocks implements LockApi {
  names: string[] = []
  private held = false
  private queue: { grant: () => void }[] = []

  async request(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown> {
    this.names.push(name)
    await Promise.resolve()
    const run = async (): Promise<void> => {
      this.held = true
      try {
        await callback({})
      } finally {
        this.held = false
        this.queue.shift()?.grant()
      }
    }
    if (!this.held) return run()
    if (options.ifAvailable) return callback(null)
    return new Promise<void>((resolve, reject) => {
      const entry = { grant: () => void run().then(resolve, reject) }
      options.signal?.addEventListener('abort', () => {
        this.queue = this.queue.filter((e) => e !== entry)
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      })
      this.queue.push(entry)
    })
  }

  get waiting(): number {
    return this.queue.length
  }
}

const tick = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createLeader', () => {
  it('the first tab leads, and holds the lock for the name the tracking channel shares', async () => {
    const locks = new FakeLocks()
    const changes: boolean[] = []
    const leader = createLeader({ locks, onChange: (l) => changes.push(l) })
    leader.start()
    await tick()
    expect(changes).toEqual([true])
    expect(leader.isLeader).toBe(true)
    expect(locks.names[0]).toBe(LOCK_NAME)
    leader.stop()
  })

  it('a second tab learns at once that it is not the leader, then waits its turn', async () => {
    const locks = new FakeLocks()
    const first = createLeader({ locks, onChange: () => undefined })
    first.start()
    await tick()
    const changes: boolean[] = []
    const second = createLeader({ locks, onChange: (l) => changes.push(l) })
    second.start()
    await tick()
    expect(changes).toEqual([false])
    expect(second.isLeader).toBe(false)
    expect(locks.waiting).toBe(1)
    first.stop()
    second.stop()
  })

  it('takes over when the leader goes away', async () => {
    const locks = new FakeLocks()
    const first = createLeader({ locks, onChange: () => undefined })
    first.start()
    await tick()
    const changes: boolean[] = []
    const second = createLeader({ locks, onChange: (l) => changes.push(l) })
    second.start()
    await tick()
    first.stop()
    await tick()
    expect(first.isLeader).toBe(false)
    expect(changes).toEqual([false, true])
    expect(second.isLeader).toBe(true)
    second.stop()
  })

  it('queues several tabs in order', async () => {
    const locks = new FakeLocks()
    const order: string[] = []
    const tabs = ['a', 'b', 'c'].map((name) =>
      createLeader({ locks, onChange: (l) => l && order.push(name) }),
    )
    for (const t of tabs) {
      t.start()
      await tick()
    }
    tabs[0]?.stop()
    await tick()
    tabs[1]?.stop()
    await tick()
    expect(order).toEqual(['a', 'b', 'c'])
    tabs[2]?.stop()
  })

  it('a tab that gives up its place never leads, even when the lock frees up', async () => {
    const locks = new FakeLocks()
    const first = createLeader({ locks, onChange: () => undefined })
    first.start()
    await tick()
    const changes: boolean[] = []
    const second = createLeader({ locks, onChange: (l) => changes.push(l) })
    second.start()
    await tick()
    second.stop()
    await tick()
    expect(locks.waiting).toBe(0)
    first.stop()
    await tick()
    expect(changes).toEqual([false])
    expect(second.isLeader).toBe(false)
  })

  it('without Web Locks every tab leads at once', () => {
    const changes: boolean[] = []
    const leader = createLeader({ locks: null, onChange: (l) => changes.push(l) })
    leader.start()
    expect(changes).toEqual([true])
    leader.stop()
    expect(changes).toEqual([true, false])
  })

  it('starting or stopping twice does nothing the second time', async () => {
    const locks = new FakeLocks()
    const changes: boolean[] = []
    const leader = createLeader({ locks, onChange: (l) => changes.push(l) })
    leader.start()
    leader.start()
    await tick()
    expect(locks.names).toHaveLength(1)
    leader.stop()
    leader.stop()
    expect(changes).toEqual([true, false])
  })

  it('a tab stopped before its election has answered never leads', async () => {
    const locks = new FakeLocks()
    const changes: boolean[] = []
    const leader = createLeader({ locks, onChange: (l) => changes.push(l) })
    leader.start()
    leader.stop()
    await tick()
    expect(changes).not.toContain(true)
    // And the lock is free for the next tab.
    const next = createLeader({ locks, onChange: () => undefined })
    next.start()
    await tick()
    expect(next.isLeader).toBe(true)
    next.stop()
  })
})

describe('readMessage', () => {
  const share = { running: true, retryAt: 1_790_000_000_000, paused: false, progress: null }

  it('reads the three messages', () => {
    expect(readMessage({ type: 'sync-now' })).toEqual({ type: 'sync-now' })
    expect(readMessage({ type: 'wrote' })).toEqual({ type: 'wrote' })
    expect(readMessage({ type: 'engine?' })).toEqual({ type: 'engine?' })
    expect(readMessage({ type: 'engine', state: share })).toEqual({ type: 'engine', state: share })
    expect(
      readMessage({
        type: 'engine',
        state: { ...share, retryAt: null, progress: { step: 'pull', rows: 500 } },
      }),
    ).toEqual({
      type: 'engine',
      state: { ...share, retryAt: null, progress: { step: 'pull', rows: 500 } },
    })
  })

  it('ignores what the tracking middleware says on the same channel', () => {
    expect(readMessage({ type: 'tracking', on: true })).toBeNull()
    expect(readMessage({ type: 'seen', stamp: 12 })).toBeNull()
  })

  it('refuses anything malformed', () => {
    expect(readMessage(null)).toBeNull()
    expect(readMessage('sync-now')).toBeNull()
    expect(readMessage({})).toBeNull()
    expect(readMessage({ type: 'engine' })).toBeNull()
    expect(readMessage({ type: 'engine', state: { ...share, running: 'yes' } })).toBeNull()
    expect(readMessage({ type: 'engine', state: { ...share, retryAt: Number.NaN } })).toBeNull()
    expect(readMessage({ type: 'engine', state: { ...share, retryAt: undefined } })).toBeNull()
    expect(
      readMessage({ type: 'engine', state: { ...share, progress: { step: 3, rows: 1 } } }),
    ).toBeNull()
  })
})

describe('the engine store', () => {
  afterEach(() => setEngineState({ ...IDLE_ENGINE }))

  it('keeps the same snapshot when nothing changed, so React does not re-render', () => {
    const before = getEngineState()
    const listener = vi.fn()
    const off = subscribeEngineState(listener)
    setEngineState({ ...IDLE_ENGINE })
    expect(getEngineState()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    setEngineState({ ...IDLE_ENGINE, running: true })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getEngineState().running).toBe(true)
    setEngineState({ ...IDLE_ENGINE, running: true, progress: { step: 'pull', rows: 1 } })
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    setEngineState({ ...IDLE_ENGINE })
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
