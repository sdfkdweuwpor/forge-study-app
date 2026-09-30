import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncSession } from '@/db/types'
import { BACKOFF_STEPS_MS, type PushRow } from '@/logic/sync'
import {
  FRESH_MS,
  INTERVAL_MS,
  PAUSED_AFTER,
  WRITE_DEBOUNCE_MS,
  WRITE_MAX_WAIT_MS,
  Scheduler,
  createEngine,
  flushPending,
  type CycleOutcome,
  type FlushDeps,
  type PageEvent,
  type Platform,
  type SchedulerState,
} from './engine'
import { IDLE_ENGINE, getEngineState, setEngineState } from './engineState'
import type { Bus, LockApi, SyncMessage } from './leader'

const SECOND = 1000
const MINUTE = 60 * SECOND

const OK: CycleOutcome = { status: 'ok' }
const fail = (
  kind: 'server' | 'offline' | 'rateLimited' | 'signedOut' | 'setup' | 'tooLarge' | 'forbidden',
  extra: { retryAfterMs?: number | null; paused?: boolean } = {},
): CycleOutcome => ({
  status: 'error',
  kind,
  retryAfterMs: extra.retryAfterMs ?? null,
  paused: extra.paused ?? false,
})

/** A cycle the test finishes by hand, so "during a cycle" is something it can write about. */
function manualCycles() {
  const calls: ((outcome: CycleOutcome) => void)[] = []
  return {
    cycle: vi.fn(
      () =>
        new Promise<CycleOutcome>((resolve) => {
          calls.push(resolve)
        }),
    ),
    /** Finishes the oldest cycle still running. */
    async finish(outcome: CycleOutcome = OK): Promise<void> {
      const resolve = calls.shift()
      if (!resolve) throw new Error('no cycle is running')
      resolve(outcome)
      await vi.advanceTimersByTimeAsync(0)
    },
    get running(): number {
      return calls.length
    },
  }
}

/** A cycle that answers at once with the next outcome in the list (the last one repeats). */
function scripted(...outcomes: CycleOutcome[]) {
  let i = 0
  return vi.fn(async () => outcomes[Math.min(i++, outcomes.length - 1)] ?? OK)
}

interface Rig {
  scheduler: Scheduler
  states: SchedulerState[]
  visible: { value: boolean }
  onOff: ReturnType<typeof vi.fn>
}

function rig(cycle: () => Promise<CycleOutcome>, random = 0.5): Rig {
  const visible = { value: true }
  const states: SchedulerState[] = []
  const onOff = vi.fn()
  const scheduler = new Scheduler({
    now: () => Date.now(),
    random: () => random,
    visible: () => visible.value,
    cycle,
    onState: (s) => states.push(s),
    onOff,
  })
  return { scheduler, states, visible, onOff }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-29T09:30:00-04:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Scheduler: what starts a cycle', () => {
  it('runs a cycle when it starts', async () => {
    const cycle = scripted(OK)
    const { scheduler } = rig(cycle)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(cycle).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('starting twice starts one rhythm and one cycle', async () => {
    const cycle = scripted(OK)
    const { scheduler } = rig(cycle)
    scheduler.start()
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(cycle).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('runs every 5 minutes while the tab is visible and skips the tick while it is hidden', async () => {
    const cycle = scripted(OK)
    const { scheduler, visible } = rig(cycle)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(cycle).toHaveBeenCalledTimes(2)
    visible.value = false
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2)
    expect(cycle).toHaveBeenCalledTimes(2)
    visible.value = true
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(cycle).toHaveBeenCalledTimes(3)
    scheduler.stop()
  })

  it('syncs three seconds after a write, and more writes push that back', async () => {
    const cycle = scripted(OK)
    const { scheduler } = rig(cycle)
    scheduler.trigger('write')
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS - 1)
    expect(cycle).not.toHaveBeenCalled()
    scheduler.trigger('write')
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS - 1)
    expect(cycle).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(cycle).toHaveBeenCalledTimes(1)
  })

  it('never waits longer than 30 seconds for a steady stream of writes', async () => {
    const cycle = scripted(OK)
    const { scheduler } = rig(cycle)
    // A write every 2 s, so the 3 s debounce alone would never fire.
    for (let t = 0; t < WRITE_MAX_WAIT_MS - 2 * SECOND; t += 2 * SECOND) {
      scheduler.trigger('write')
      await vi.advanceTimersByTimeAsync(2 * SECOND)
    }
    expect(cycle).not.toHaveBeenCalled()
    scheduler.trigger('write')
    await vi.advanceTimersByTimeAsync(2 * SECOND)
    expect(cycle).toHaveBeenCalledTimes(1)
    // The wait starts over with the next write.
    scheduler.trigger('write')
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
    expect(cycle).toHaveBeenCalledTimes(2)
  })

  it('syncs on focus only when the last cycle ended more than 30 seconds ago', async () => {
    const cycle = scripted(OK)
    const { scheduler } = rig(cycle)
    scheduler.trigger('focus') // never synced: goes
    await vi.advanceTimersByTimeAsync(0)
    expect(cycle).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(FRESH_MS)
    scheduler.trigger('focus') // exactly 30 s: still fresh
    await vi.advanceTimersByTimeAsync(0)
    expect(cycle).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    scheduler.trigger('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(cycle).toHaveBeenCalledTimes(2)
  })

  it('a focus during a cycle does not ask for another', async () => {
    const cycles = manualCycles()
    const { scheduler } = rig(cycles.cycle)
    scheduler.trigger('focus')
    await vi.advanceTimersByTimeAsync(0)
    scheduler.trigger('focus')
    await cycles.finish()
    expect(cycles.cycle).toHaveBeenCalledTimes(1)
  })

  it('syncs when the browser comes back online', async () => {
    const cycle = scripted(OK)
    const { scheduler } = rig(cycle)
    scheduler.trigger('online')
    await vi.advanceTimersByTimeAsync(0)
    expect(cycle).toHaveBeenCalledTimes(1)
  })

  it('runs one more cycle after one that a write arrived during, and only one', async () => {
    const cycles = manualCycles()
    const { scheduler } = rig(cycles.cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    scheduler.trigger('write')
    scheduler.trigger('manual')
    scheduler.trigger('manual')
    // The write timer fires while the first cycle still runs.
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
    expect(cycles.cycle).toHaveBeenCalledTimes(1)
    await cycles.finish()
    expect(cycles.cycle).toHaveBeenCalledTimes(2)
    await cycles.finish()
    expect(cycles.cycle).toHaveBeenCalledTimes(2)
  })

  it('does nothing after it is stopped', async () => {
    const cycle = scripted(OK)
    const { scheduler } = rig(cycle)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    scheduler.stop()
    scheduler.trigger('manual')
    scheduler.trigger('write')
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2)
    expect(cycle).toHaveBeenCalledTimes(1)
  })
})

describe('Scheduler: after a failure', () => {
  it('backs off 15 s, 1 min, 5 min, then 15 min, and starts over after a success', async () => {
    const cycle = scripted(fail('server'), fail('server'), fail('server'), fail('server'), fail('server'), OK, fail('server'))
    const { scheduler, states } = rig(cycle, 0.5)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    expect(cycle).toHaveBeenCalledTimes(1)
    const last = () => states.at(-1)
    expect(last()?.retryAt).toBe(Date.now() + BACKOFF_STEPS_MS[0]!)

    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[0]! - 1)
    expect(cycle).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(cycle).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[1]!)
    expect(cycle).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[2]!)
    expect(cycle).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[3]!)
    expect(cycle).toHaveBeenCalledTimes(5)
    // The cap: the next wait is 15 minutes again.
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[3]!)
    expect(cycle).toHaveBeenCalledTimes(6)
    // That one worked: a new failure starts at 15 s again.
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    expect(cycle).toHaveBeenCalledTimes(7)
    expect(last()?.retryAt).toBe(Date.now() + BACKOFF_STEPS_MS[0]!)
    scheduler.stop()
  })

  it('keeps the jitter inside plus or minus 20 percent', async () => {
    for (const [random, expected] of [
      [0, 12_000],
      [0.999, 18_000],
    ] as const) {
      const { scheduler, states } = rig(scripted(fail('server')), random)
      scheduler.trigger('manual')
      await vi.advanceTimersByTimeAsync(0)
      const wait = (states.at(-1)?.retryAt ?? 0) - Date.now()
      expect(Math.abs(wait - expected)).toBeLessThanOrEqual(10)
      scheduler.stop()
    }
  })

  it('waits at least as long as a 429 asked', async () => {
    const cycle = scripted(fail('rateLimited', { retryAfterMs: 5 * MINUTE }), OK)
    const { scheduler } = rig(cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1)
    expect(cycle).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(cycle).toHaveBeenCalledTimes(2)
  })

  it('waits at least a minute after a 429 that named no wait', async () => {
    const cycle = scripted(fail('rateLimited'), OK)
    const { scheduler } = rig(cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(MINUTE - 1)
    expect(cycle).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(cycle).toHaveBeenCalledTimes(2)
  })

  it('does not jump the queue for a write, a focus or the 5-minute tick', async () => {
    const cycle = scripted(fail('server'), OK)
    const { scheduler } = rig(cycle)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    scheduler.trigger('write')
    scheduler.trigger('focus')
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[0]! - 1)
    expect(cycle).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(cycle).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('"Sync now" forgets the wait at once', async () => {
    const cycle = scripted(fail('server'), fail('server'), OK)
    const { scheduler } = rig(cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[0]!)
    expect(cycle).toHaveBeenCalledTimes(2) // second failure: a one-minute wait
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    expect(cycle).toHaveBeenCalledTimes(3)
    // Nothing is left waiting from the old schedule.
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[1]! * 2)
    expect(cycle).toHaveBeenCalledTimes(3)
  })

  it('offline waits for the online event, and tries on its own schedule if that never comes', async () => {
    const cycle = scripted(fail('offline'), OK)
    const { scheduler } = rig(cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    scheduler.trigger('write')
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS * 2)
    expect(cycle).toHaveBeenCalledTimes(1)
    scheduler.trigger('online')
    await vi.advanceTimersByTimeAsync(0)
    expect(cycle).toHaveBeenCalledTimes(2)

    const second = scripted(fail('offline'), OK)
    const other = rig(second)
    other.scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[0]!)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('an online event also ends a wait after a server error, without forgetting the count', async () => {
    const cycle = scripted(fail('server'), fail('server'), OK)
    const { scheduler, states } = rig(cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    scheduler.trigger('online')
    await vi.advanceTimersByTimeAsync(0)
    expect(cycle).toHaveBeenCalledTimes(2)
    // The second failure waits a minute, not 15 seconds.
    expect((states.at(-1)?.retryAt ?? 0) - Date.now()).toBe(BACKOFF_STEPS_MS[1])
  })

  it.each(['signedOut', 'setup', 'forbidden'] as const)(
    '%s stops until the person acts, whatever else happens',
    async (kind) => {
      const cycle = scripted(fail(kind), OK)
      const { scheduler, states } = rig(cycle)
      scheduler.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(states.at(-1)?.stalled).toBe(true)
      expect(states.at(-1)?.retryAt).toBeNull()
      scheduler.trigger('write')
      scheduler.trigger('focus')
      scheduler.trigger('online')
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)
      expect(cycle).toHaveBeenCalledTimes(1)
      scheduler.trigger('manual')
      await vi.advanceTimersByTimeAsync(0)
      expect(cycle).toHaveBeenCalledTimes(2)
      expect(states.at(-1)?.stalled).toBe(false)
      scheduler.stop()
    },
  )

  it('treats a 413 that could not be split like any other failure', async () => {
    const cycle = scripted(fail('tooLarge'), OK)
    const { scheduler } = rig(cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[0]!)
    expect(cycle).toHaveBeenCalledTimes(2)
  })

  it('counts a cycle that throws as a server error', async () => {
    const cycle = vi
      .fn<() => Promise<CycleOutcome>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(OK)
    const { scheduler } = rig(cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[0]!)
    expect(cycle).toHaveBeenCalledTimes(2)
  })

  it('does not rerun after a failed cycle just because a write came in during it', async () => {
    const cycles = manualCycles()
    const { scheduler } = rig(cycles.cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    scheduler.trigger('manual')
    await cycles.finish(fail('server'))
    expect(cycles.cycle).toHaveBeenCalledTimes(1)
  })
})

describe('Scheduler: a paused project', () => {
  it('is called paused only after several answers in a row, never after one', async () => {
    const cycle = scripted(
      fail('server', { paused: true }),
      fail('server', { paused: true }),
      fail('server', { paused: true }),
      OK,
    )
    const { scheduler, states } = rig(cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    expect(states.at(-1)?.paused).toBe(false)
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[0]!)
    expect(states.at(-1)?.paused).toBe(false)
    expect(PAUSED_AFTER).toBe(3)
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[1]!)
    expect(cycle).toHaveBeenCalledTimes(3)
    expect(states.at(-1)?.paused).toBe(true)
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[2]!)
    expect(states.at(-1)?.paused).toBe(false)
  })

  it('an ordinary failure in between starts the count over', async () => {
    const cycle = scripted(
      fail('server', { paused: true }),
      fail('server', { paused: true }),
      fail('server'),
      fail('server', { paused: true }),
      fail('server', { paused: true }),
    )
    const { scheduler, states } = rig(cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    for (const step of BACKOFF_STEPS_MS.slice(0, 4)) await vi.advanceTimersByTimeAsync(step)
    expect(cycle).toHaveBeenCalledTimes(5)
    expect(states.at(-1)?.paused).toBe(false)
  })

  it('"Sync now" clears it', async () => {
    const cycle = scripted(
      fail('server', { paused: true }),
      fail('server', { paused: true }),
      fail('server', { paused: true }),
      fail('server', { paused: true }),
    )
    const { scheduler, states } = rig(cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[0]!)
    await vi.advanceTimersByTimeAsync(BACKOFF_STEPS_MS[1]!)
    expect(states.at(-1)?.paused).toBe(true)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    expect(states.at(-1)?.paused).toBe(false)
  })
})

describe('Scheduler: state and switching off', () => {
  it('reports running and only real changes', async () => {
    const cycles = manualCycles()
    const { scheduler, states } = rig(cycles.cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    expect(states.map((s) => s.running)).toEqual([true])
    await cycles.finish()
    expect(states.map((s) => s.running)).toEqual([true, false])
  })

  it('stops for good when a cycle finds sync switched off', async () => {
    const cycle = scripted({ status: 'off' }, OK)
    const { scheduler, onOff } = rig(cycle)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(onOff).toHaveBeenCalledTimes(1)
    // What the engine does in response to `onOff`: stop the scheduler.
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2)
    expect(cycle).toHaveBeenCalledTimes(1)
  })

  it('tries again soon after "another cycle is running"', async () => {
    const cycle = scripted({ status: 'busy' }, OK)
    const { scheduler } = rig(cycle)
    scheduler.trigger('manual')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(SECOND)
    expect(cycle).toHaveBeenCalledTimes(2)
  })
})

// ─── One tab ────────────────────────────────────────────────────────────────

class FakeBus implements Bus {
  readonly sent: SyncMessage[] = []
  private handlers = new Set<(m: SyncMessage) => void>()
  closed = false
  post(message: SyncMessage): void {
    this.sent.push(message)
  }
  listen(fn: (m: SyncMessage) => void): () => void {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }
  close(): void {
    this.closed = true
  }
  /** A message from another tab. */
  receive(message: SyncMessage): void {
    for (const fn of [...this.handlers]) fn(message)
  }
  get listening(): number {
    return this.handlers.size
  }
}

/** Web Locks for one name: the first request holds it; `ifAvailable` answers null when it is held. */
class FakeLocks implements LockApi {
  private held = false
  private queue: { grant: () => void }[] = []
  async request(
    _name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown> {
    // Like the real thing, the answer comes a moment later, not while the caller is still running.
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
    if (options.ifAvailable) return Promise.resolve(callback(null))
    return new Promise<void>((resolve, reject) => {
      const entry = { grant: () => void run().then(resolve, reject) }
      options.signal?.addEventListener('abort', () => {
        this.queue = this.queue.filter((e) => e !== entry)
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      })
      this.queue.push(entry)
    })
  }
}

interface TabOptions {
  locks?: LockApi | null
  bus?: FakeBus | null
  cycle?: Platform['cycle']
}

function tab(options: TabOptions = {}) {
  const bus = options.bus === undefined ? new FakeBus() : options.bus
  const page = new Map<PageEvent, Set<() => void>>()
  const writes = new Set<() => void>()
  const idle: { job: () => void; delayMs: number; cancelled: boolean }[] = []
  const gate = vi.fn()
  const flush = vi.fn(async () => undefined)
  const cycle: Platform['cycle'] = options.cycle ?? vi.fn(async () => OK)
  const platform: Platform = {
    now: () => Date.now(),
    random: () => 0.5,
    visible: () => true,
    cycle,
    flush,
    locks: options.locks === undefined ? null : options.locks,
    bus,
    idle: (job, delayMs) => {
      const entry = { job, delayMs, cancelled: false }
      idle.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
    on: (event, fn) => {
      const set = page.get(event) ?? new Set()
      set.add(fn)
      page.set(event, set)
      return () => set.delete(fn)
    },
    onWrite: (fn) => {
      writes.add(fn)
      return () => writes.delete(fn)
    },
    settleGate: gate,
  }
  const engine = createEngine(platform, { delayMs: 250 })
  return {
    engine,
    bus,
    gate,
    flush,
    cycle,
    idle,
    emit: (event: PageEvent) => page.get(event)?.forEach((fn) => fn()),
    write: () => writes.forEach((fn) => fn()),
    listeners: () => [...page.values()].reduce((n, s) => n + s.size, 0) + writes.size,
    /** Runs the start-up job the browser would run when idle. */
    async startUp(): Promise<void> {
      for (const entry of idle) if (!entry.cancelled) entry.job()
      await vi.advanceTimersByTimeAsync(0)
    },
  }
}

describe('createEngine: the tab that syncs', () => {
  afterEach(() => {
    setEngineState({ ...IDLE_ENGINE })
  })

  it('without Web Locks every tab runs, and starts its first cycle when the browser is idle', async () => {
    const t = tab({ locks: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(getEngineState().leader).toBe(true)
    expect(t.idle).toHaveLength(1)
    expect(t.idle[0]?.delayMs).toBe(250)
    expect(t.cycle).not.toHaveBeenCalled()
    await t.startUp()
    expect(t.cycle).toHaveBeenCalledTimes(1)
    t.engine.stop()
  })

  it('syncs when a write, a focus or the page coming back says so', async () => {
    const t = tab({ locks: null })
    await t.startUp()
    await vi.advanceTimersByTimeAsync(FRESH_MS + 1)
    t.emit('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.cycle).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(FRESH_MS + 1)
    t.emit('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.cycle).toHaveBeenCalledTimes(3)
    t.write()
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
    expect(t.cycle).toHaveBeenCalledTimes(4)
    t.emit('online')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.cycle).toHaveBeenCalledTimes(5)
    t.engine.stop()
  })

  it('shows what the cycle is doing, and the first sync\'s progress', async () => {
    let report: (p: { step: 'pull'; rows: number }) => void = () => undefined
    let done: () => void = () => undefined
    const t = tab({
      locks: null,
      cycle: (progress) => {
        report = progress
        return new Promise<CycleOutcome>((resolve) => {
          done = () => resolve(OK)
        })
      },
    })
    await t.startUp()
    expect(getEngineState()).toMatchObject({ leader: true, running: true, progress: null })
    report({ step: 'pull', rows: 500 })
    expect(getEngineState().progress).toEqual({ step: 'pull', rows: 500 })
    done()
    await vi.advanceTimersByTimeAsync(0)
    expect(getEngineState()).toMatchObject({ running: false, progress: null })
    t.engine.stop()
  })

  it('tells the other tabs how it is doing, and answers "how are you" at once', async () => {
    const t = tab({ locks: null })
    await t.startUp()
    const last = () => t.bus?.sent.filter((m) => m.type === 'engine').at(-1)
    expect(last()).toMatchObject({ state: { running: false, retryAt: null, paused: false } })
    const before = t.bus?.sent.length ?? 0
    t.bus?.receive({ type: 'engine?' })
    expect(t.bus?.sent.length).toBe(before + 1)
    t.engine.stop()
  })

  it('runs a cycle when another tab presses "Sync now" or writes', async () => {
    const t = tab({ locks: null })
    await t.startUp()
    t.bus?.receive({ type: 'sync-now' })
    await vi.advanceTimersByTimeAsync(0)
    expect(t.cycle).toHaveBeenCalledTimes(2)
    t.bus?.receive({ type: 'wrote' })
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS)
    expect(t.cycle).toHaveBeenCalledTimes(3)
    t.engine.stop()
  })

  it('"Sync now" before the election has answered runs once it has', async () => {
    const t = tab({ locks: new FakeLocks() })
    t.engine.syncNow()
    expect(t.cycle).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.cycle).toHaveBeenCalledTimes(1)
    // The start-up cycle asks for one more behind it.
    await t.startUp()
    expect(t.cycle).toHaveBeenCalledTimes(2)
    t.engine.stop()
  })

  it('pushes a flush when the page is hidden, unless a cycle is running or sync needs the person', async () => {
    const cycles = manualCycles()
    const t = tab({ locks: null, cycle: cycles.cycle })
    await t.startUp()
    t.emit('hidden')
    expect(t.flush).not.toHaveBeenCalled() // the running cycle pushes
    await cycles.finish()
    t.emit('hidden')
    expect(t.flush).toHaveBeenCalledTimes(1)
    t.engine.syncNow()
    await vi.advanceTimersByTimeAsync(0)
    await cycles.finish(fail('signedOut'))
    t.emit('hidden')
    expect(t.flush).toHaveBeenCalledTimes(1)
    t.engine.stop()
  })

  it('stops on its own when a cycle finds sync switched off, and lets go of everything', async () => {
    const stopped = vi.fn()
    const cycle = vi.fn(async (): Promise<CycleOutcome> => ({ status: 'off' }))
    const bus = new FakeBus()
    const writes = new Set<() => void>()
    const t = createEngine(
      {
        now: () => Date.now(),
        random: () => 0.5,
        visible: () => true,
        cycle,
        flush: async () => undefined,
        locks: null,
        bus,
        idle: (job) => {
          job()
          return () => undefined
        },
        on: () => () => undefined,
        onWrite: (fn) => {
          writes.add(fn)
          return () => writes.delete(fn)
        },
        settleGate: vi.fn(),
      },
      { onStop: stopped },
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(stopped).toHaveBeenCalledTimes(1)
    expect(bus.closed).toBe(true)
    expect(bus.listening).toBe(0)
    expect(writes.size).toBe(0)
    expect(getEngineState()).toEqual(IDLE_ENGINE)
    t.stop()
    expect(stopped).toHaveBeenCalledTimes(1)
  })

  it('stop() ends every timer and listener and opens the start-up gate', async () => {
    const t = tab({ locks: null })
    await t.startUp()
    expect(t.listeners()).toBeGreaterThan(0)
    t.engine.stop()
    expect(t.listeners()).toBe(0)
    expect(t.bus?.closed).toBe(true)
    expect(t.gate).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2)
    expect(t.cycle).toHaveBeenCalledTimes(1)
  })
})

describe('createEngine: a tab that is not the one syncing', () => {
  afterEach(() => {
    setEngineState({ ...IDLE_ENGINE })
  })

  it('opens the start-up gate at once, never runs a cycle, and asks the leader how it is doing', async () => {
    const locks = new FakeLocks()
    const leader = tab({ locks })
    await vi.advanceTimersByTimeAsync(0)
    const follower = tab({ locks })
    await vi.advanceTimersByTimeAsync(0)
    expect(leader.gate).not.toHaveBeenCalled()
    expect(follower.gate).toHaveBeenCalledTimes(1)
    expect(follower.bus?.sent).toContainEqual({ type: 'engine?' })
    await follower.startUp()
    expect(follower.cycle).not.toHaveBeenCalled()
    leader.engine.stop()
    follower.engine.stop()
  })

  it('relays "Sync now" and its writes to the leader, and shows what the leader says', async () => {
    const locks = new FakeLocks()
    const leader = tab({ locks })
    await vi.advanceTimersByTimeAsync(0)
    const follower = tab({ locks })
    await vi.advanceTimersByTimeAsync(0)
    follower.engine.syncNow()
    follower.write()
    expect(follower.bus?.sent).toContainEqual({ type: 'sync-now' })
    expect(follower.bus?.sent).toContainEqual({ type: 'wrote' })
    follower.bus?.receive({
      type: 'engine',
      state: { running: true, retryAt: null, paused: false, progress: null },
    })
    expect(getEngineState()).toMatchObject({ leader: false, running: true })
    leader.engine.stop()
    follower.engine.stop()
  })

  it('takes over when the leader closes, and starts syncing', async () => {
    const locks = new FakeLocks()
    const first = tab({ locks })
    await first.startUp()
    const second = tab({ locks })
    await vi.advanceTimersByTimeAsync(0)
    expect(second.cycle).not.toHaveBeenCalled()
    first.engine.stop()
    await vi.advanceTimersByTimeAsync(0)
    await second.startUp()
    expect(second.cycle).toHaveBeenCalledTimes(1)
    second.engine.stop()
  })
})

// ─── The hide-time flush ────────────────────────────────────────────────────

const row = (id: string, size = 10): PushRow => ({
  tbl: 'tasks',
  id,
  updatedAt: 1_790_000_000_000,
  deviceId: 'device-a',
  deleted: false,
  schemaVersion: 3,
  data: { id, title: 'x'.repeat(size) },
})

// Assembled at run time: nothing in this file looks like a token.
const session = (over: Partial<SyncSession> = {}): SyncSession => ({
  accessToken: ['test', 'access'].join('-'),
  refreshToken: ['test', 'refresh'].join('-'),
  expiresAt: Date.now() + 30 * MINUTE,
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  ...over,
})

const config = { url: 'https://abcdefghijklmnopqrst.supabase.co', anonKey: 'k', keyKind: 'anonJwt' as const }

describe('flushPending', () => {
  const deps = (over: Partial<FlushDeps> = {}) => {
    const push = vi.fn<FlushDeps['push']>(async () => undefined)
    return {
      push,
      deps: {
        now: () => Date.now(),
        pending: async () => [row('task-c182-u1-1')],
        connection: async () => ({ session: session(), config }),
        push,
        ...over,
      },
    }
  }

  it('pushes what is waiting, with the session and the project', async () => {
    const { push, deps: d } = deps()
    await expect(flushPending(d)).resolves.toBe('sent')
    expect(push).toHaveBeenCalledTimes(1)
    const [rows] = push.mock.calls[0] ?? []
    expect(rows).toHaveLength(1)
  })

  it('has nothing to do when nothing is waiting', async () => {
    const { push, deps: d } = deps({ pending: async () => [] })
    await expect(flushPending(d)).resolves.toBe('nothing')
    expect(push).not.toHaveBeenCalled()
  })

  it('leaves a batch over 60 KB to the next cycle', async () => {
    const { push, deps: d } = deps({
      pending: async () => [row('a', 40_000), row('b', 40_000)],
    })
    await expect(flushPending(d)).resolves.toBe('skipped')
    expect(push).not.toHaveBeenCalled()
  })

  it('sends a batch just under 60 KB', async () => {
    const { push, deps: d } = deps({ pending: async () => [row('a', 30_000), row('b', 20_000)] })
    await expect(flushPending(d)).resolves.toBe('sent')
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('does not start a refresh while the page goes away: a token about to expire is skipped', async () => {
    const soon = session({ expiresAt: Date.now() + 30 * SECOND })
    const { push, deps: d } = deps({ connection: async () => ({ session: soon, config }) })
    await expect(flushPending(d)).resolves.toBe('skipped')
    expect(push).not.toHaveBeenCalled()
  })

  it('skips when signed out or without a project', async () => {
    const { push, deps: d } = deps({ connection: async () => null })
    await expect(flushPending(d)).resolves.toBe('skipped')
    expect(push).not.toHaveBeenCalled()
  })

  it('never throws, whatever goes wrong', async () => {
    const failing = deps({ push: vi.fn().mockRejectedValue(new Error('network')) })
    await expect(flushPending(failing.deps)).resolves.toBe('skipped')
    const reading = deps({ pending: () => Promise.reject(new Error('db')) })
    await expect(flushPending(reading.deps)).resolves.toBe('skipped')
  })
})
