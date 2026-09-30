/**
 * The sync engine (PLAN §4.7.5, "Triggers and the main thread"): it decides when `runSyncCycle` runs and
 * what happens after it fails. Everything about a cycle itself is in `@/db/repos/sync`; this file only
 * schedules, in one tab. It is imported only when sync is on.
 *
 * When a cycle runs (in the one tab that holds the lock, see `leader.ts`):
 *  - at start, once the browser is idle after the first paint;
 *  - 3 s after a write that was queued (more writes push it back, but never past 30 s of waiting);
 *  - when the tab becomes visible or the window is focused, if the last cycle ended over 30 s ago;
 *  - when the browser comes back online;
 *  - every 5 minutes while the tab is visible;
 *  - "Sync now", which also forgets the backoff.
 * A trigger that arrives during a cycle sets `again`: one more cycle runs after it.
 *
 * After a failure it waits as `planRetry` says (15 s, 1 min, 5 min, 15 min with jitter; a 429 at least as
 * long as it asked; offline until the `online` event) or, for signed out, setup, forbidden and "update
 * needed", until the person acts. A project that answers with 5xx/540 several times in a row is reported
 * as possibly paused; one such answer is not (`suggestsPaused` is counted over consecutive cycles).
 *
 * When the page is hidden, the changes that fit in 60 KB are pushed with `keepalive`, so a phone that is
 * put away still sends its last edits.
 *
 * `Scheduler` has no idea what a cycle is, and `createEngine` takes the browser as an argument, so both
 * run under fake timers in `engine.test.ts`.
 */
import { recordError } from '@/app/reportError'
import {
  getSyncSession,
  getSyncState,
  pendingPushRows,
  runSyncCycle,
  type SyncProgress,
} from '@/db/repos/sync'
import { settleStartupSync } from '@/db/repos/syncGate'
import type { SyncErrorKind, SyncSession } from '@/db/types'
import { whenIdle } from '@/lib/idle'
import {
  SyncTransportError,
  backoffMs,
  fitsKeepalive,
  planRetry,
  tokenNeedsRefresh,
  type PushRow,
  type SyncServer,
} from '@/logic/sync'
import { SYNC_TEXT } from '@/logic/syncApply'
import type { TransportConfig } from '@/logic/syncRequests'
import { browserSend, transportOf } from './client'
import { IDLE_ENGINE, setEngineState } from './engineState'
import { createBus, createLeader, type Bus, type EngineShare, type LockApi } from './leader'
import { onTrackedWrite } from './queries'
import { refreshSession } from './supabase/auth'
import { SupabaseError, suggestsPaused, type Send } from './supabase/http'
import { createSyncServer } from './supabase/rest'

// ─── The schedule ───────────────────────────────────────────────────────────

/** A write waits this long for more writes before a cycle runs. */
export const WRITE_DEBOUNCE_MS = 3_000
/** ...and never longer than this from the first of them. */
export const WRITE_MAX_WAIT_MS = 30_000
/** A focus or a return to the tab syncs only when the last cycle ended longer ago than this. */
export const FRESH_MS = 30_000
/** The rhythm while the tab is visible. */
export const INTERVAL_MS = 5 * 60_000
/** Consecutive cycles that ended in a `suggestsPaused` answer before the project is called paused. */
export const PAUSED_AFTER = 3
/** After "another cycle is running in this page" (which this engine never causes). */
const BUSY_RETRY_MS = 1_000
/** The first cycle of a page load, after the browser has been idle (and at least) this long. */
export const START_DELAY_MS = 400

/** How one cycle ended, as far as the schedule cares. */
export type CycleOutcome =
  | { status: 'ok' }
  | { status: 'off' }
  | { status: 'busy' }
  | { status: 'error'; kind: SyncErrorKind; retryAfterMs: number | null; paused: boolean }

export type Trigger = 'start' | 'write' | 'focus' | 'online' | 'interval' | 'manual'

export interface SchedulerState {
  running: boolean
  /** When the next try is due after a failure. */
  retryAt: number | null
  /** Repeated 5xx / 540 answers. */
  paused: boolean
  /** Stopped until the person acts: signed out, setup, forbidden, update needed. */
  stalled: boolean
}

export interface SchedulerEnv {
  now(): number
  /** In [0, 1), for the jitter. */
  random(): number
  /** The tab is visible. */
  visible(): boolean
  /** Runs one cycle. Should not reject; if it does, it counts as a server error. */
  cycle(): Promise<CycleOutcome>
  /** The state changed. */
  onState(state: SchedulerState): void
  /** A cycle found sync switched off. */
  onOff(): void
}

type Timer = ReturnType<typeof setTimeout>
type Waiting = 'none' | 'time' | 'online' | 'person'

export class Scheduler {
  private running = false
  private again = false
  private failures = 0
  private pausedRun = 0
  private retryAt: number | null = null
  private waiting: Waiting = 'none'
  private lastEnd: number | null = null
  private writeTimer: Timer | null = null
  private writeSince: number | null = null
  private retryTimer: Timer | null = null
  private rhythm: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private shown = ''

  constructor(private readonly env: SchedulerEnv) {}

  get state(): SchedulerState {
    return {
      running: this.running,
      retryAt: this.retryAt,
      paused: this.pausedRun >= PAUSED_AFTER,
      stalled: this.waiting === 'person',
    }
  }

  /** Begins the 5-minute rhythm and runs the first cycle. Safe to call twice. */
  start(): void {
    if (this.stopped || this.rhythm !== null) return
    this.rhythm = setInterval(() => this.trigger('interval'), INTERVAL_MS)
    this.trigger('start')
  }

  /** Ends every timer for good. */
  stop(): void {
    this.stopped = true
    if (this.rhythm !== null) clearInterval(this.rhythm)
    if (this.writeTimer !== null) clearTimeout(this.writeTimer)
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.rhythm = this.writeTimer = this.retryTimer = null
  }

  trigger(reason: Trigger): void {
    if (this.stopped) return
    switch (reason) {
      case 'manual':
        // "Sync now" forgets the backoff and the stop, and never waits.
        this.failures = 0
        this.pausedRun = 0
        this.clearWait()
        this.run()
        return
      case 'start':
        if (this.waiting === 'none') this.run()
        return
      case 'write':
        this.armWrite()
        return
      case 'online':
        // The network is back: a retry that was waiting for it, or on a timer, goes now.
        if (this.waiting === 'online' || this.waiting === 'time') this.clearWait()
        if (this.waiting === 'none') this.run()
        return
      case 'focus':
        if (this.waiting === 'none' && !this.running && this.isStale()) this.run()
        return
      case 'interval':
        if (this.waiting === 'none' && !this.running && this.env.visible()) this.run()
        return
    }
  }

  private isStale(): boolean {
    return this.lastEnd === null || this.env.now() - this.lastEnd > FRESH_MS
  }

  private armWrite(): void {
    const now = this.env.now()
    this.writeSince ??= now
    const wait = Math.min(WRITE_DEBOUNCE_MS, Math.max(0, this.writeSince + WRITE_MAX_WAIT_MS - now))
    if (this.writeTimer !== null) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.writeSince = null
      // A failure's own timer, or the person, decides when to try again; a write does not jump the queue.
      if (this.waiting === 'none') this.run()
    }, wait)
  }

  private run(): void {
    if (this.stopped) return
    if (this.running) {
      this.again = true
      return
    }
    this.running = true
    this.again = false
    this.emit()
    this.env.cycle().then(
      (outcome) => this.finish(outcome),
      () => this.finish({ status: 'error', kind: 'server', retryAfterMs: null, paused: false }),
    )
  }

  private finish(outcome: CycleOutcome): void {
    this.running = false
    if (this.stopped) return
    this.lastEnd = this.env.now()
    if (outcome.status === 'off') {
      this.env.onOff()
      return
    }
    if (outcome.status === 'busy') {
      this.again = false
      this.schedule('time', this.env.now() + BUSY_RETRY_MS)
    } else if (outcome.status === 'ok') {
      this.failures = 0
      this.pausedRun = 0
      this.clearWait()
      if (this.again) {
        this.run()
        return
      }
    } else {
      this.again = false
      this.fail(outcome)
    }
    this.emit()
  }

  private fail(outcome: Extract<CycleOutcome, { status: 'error' }>): void {
    this.failures += 1
    this.pausedRun = outcome.paused ? this.pausedRun + 1 : 0
    const now = this.env.now()
    const plan = planRetry(outcome.kind, {
      now,
      failures: this.failures,
      random: this.env.random(),
      retryAfterMs: outcome.retryAfterMs,
    })
    switch (plan.mode) {
      case 'at':
        this.schedule('time', plan.at)
        return
      case 'online':
        this.schedule('online', plan.at)
        return
      case 'shrink':
        // The repo engine already split the batch as far as it goes: this is a plain failure now.
        this.schedule('time', now + backoffMs(this.failures, this.env.random()))
        return
      case 'manual':
        this.clearWait()
        this.waiting = 'person'
        return
    }
  }

  /** Waits until `at` (or, for `online`, until the browser says so, and at the latest `at`). */
  private schedule(waiting: 'time' | 'online', at: number): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.waiting = waiting
    this.retryAt = at
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null
        this.waiting = 'none'
        this.retryAt = null
        this.run()
      },
      Math.max(0, at - this.env.now()),
    )
  }

  private clearWait(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.retryAt = null
    this.waiting = 'none'
  }

  private emit(): void {
    const state = this.state
    const key = JSON.stringify(state)
    if (key === this.shown) return
    this.shown = key
    this.env.onState(state)
  }
}

// ─── One tab, the browser around it ─────────────────────────────────────────

export type PageEvent = 'visible' | 'hidden' | 'focus' | 'online'

/** Everything `createEngine` needs from the browser and the data layer. */
export interface Platform {
  now(): number
  random(): number
  visible(): boolean
  /** Runs one real cycle. Never rejects. */
  cycle(progress: (p: SyncProgress) => void): Promise<CycleOutcome>
  /** Pushes what fits in 60 KB with `keepalive`. Never rejects. */
  flush(): Promise<void>
  locks: LockApi | null
  bus: Bus | null
  /** Runs `job` when the browser is idle, after `delayMs`. Returns the cancel. */
  idle(job: () => void, delayMs: number): () => void
  /** A page event. Returns the unsubscribe. */
  on(event: PageEvent, fn: () => void): () => void
  /** A write was queued in this tab. Returns the unsubscribe. */
  onWrite(fn: () => void): () => void
  /** Opens the start-up gate (goals wait for the first cycle of a page load). */
  settleGate(): void
}

export interface Engine {
  /** The person asked: sync now, and forget the backoff. Reaches the leader from any tab. */
  syncNow(): void
  /** Leaves the election and ends every timer and listener. */
  stop(): void
}

export interface EngineOptions {
  delayMs?: number
  onStop?: () => void
}

/**
 * One tab's engine. It joins the election; the tab that wins runs a `Scheduler`, the others relay "Sync
 * now" and their writes to it and show what it reports.
 */
export function createEngine(p: Platform, options: EngineOptions = {}): Engine {
  let leading = false
  let decided = false
  let wantNow = false
  let stopped = false
  let progress: EngineShare['progress'] = null
  let cancelStart: (() => void) | null = null

  const share = (s: {
    running: boolean
    retryAt: number | null
    paused: boolean
  }): EngineShare => ({
    running: s.running,
    retryAt: s.retryAt,
    paused: s.paused,
    progress,
  })
  const publish = (): void => {
    if (stopped || !leading) return
    const mine = share(scheduler.state)
    setEngineState({ leader: true, ...mine })
    p.bus?.post({ type: 'engine', state: mine })
  }

  const scheduler = new Scheduler({
    now: p.now,
    random: p.random,
    visible: p.visible,
    cycle: async () => {
      try {
        return await p.cycle((next) => {
          progress = next
          publish()
        })
      } finally {
        progress = null
      }
    },
    onState: publish,
    onOff: () => engine.stop(),
  })

  const syncNow = (): void => {
    if (!decided) {
      wantNow = true
      return
    }
    if (leading) scheduler.trigger('manual')
    else p.bus?.post({ type: 'sync-now' })
  }

  const leader = createLeader({
    locks: p.locks,
    onChange: (isLeader) => {
      if (stopped) return
      leading = isLeader
      decided = true
      if (isLeader) {
        setEngineState({ leader: true, ...share(scheduler.state) })
        cancelStart = p.idle(() => scheduler.start(), options.delayMs ?? START_DELAY_MS)
      } else {
        setEngineState({ ...IDLE_ENGINE })
        // Another tab syncs; this one has nothing to wait for.
        p.settleGate()
        p.bus?.post({ type: 'engine?' })
      }
      if (wantNow) {
        wantNow = false
        syncNow()
      }
    },
  })

  const offs: (() => void)[] = [
    p.on('visible', () => scheduler.trigger('focus')),
    p.on('focus', () => scheduler.trigger('focus')),
    p.on('online', () => scheduler.trigger('online')),
    p.on('hidden', () => {
      const s = scheduler.state
      if (!s.running && !s.stalled) void p.flush()
    }),
    p.onWrite(() => {
      if (leading) scheduler.trigger('write')
      else if (decided) p.bus?.post({ type: 'wrote' })
    }),
  ]
  if (p.bus) {
    offs.push(
      p.bus.listen((message) => {
        if (stopped) return
        if (leading) {
          if (message.type === 'sync-now') scheduler.trigger('manual')
          else if (message.type === 'wrote') scheduler.trigger('write')
          else if (message.type === 'engine?') publish()
        } else if (message.type === 'engine') {
          setEngineState({ leader: false, ...message.state })
        }
      }),
    )
  }

  const engine: Engine = {
    syncNow,
    stop() {
      if (stopped) return
      stopped = true
      cancelStart?.()
      scheduler.stop()
      for (const off of offs) off()
      leader.stop()
      p.bus?.close()
      setEngineState({ ...IDLE_ENGINE })
      p.settleGate()
      options.onStop?.()
    },
  }
  leader.start()
  return engine
}

// ─── The real cycle and the hide-time flush ─────────────────────────────────

/**
 * One real cycle: the transport over `fetch`, the session refreshed through GoTrue when the repo engine
 * asks, and the outcome reduced to what the schedule needs. A failure that is not a transport failure (a
 * database error) goes to the error log and counts as a server error, so sync backs off instead of
 * spinning.
 */
export async function runOnce(
  send: Send,
  progress: (p: SyncProgress) => void,
  now: () => number = Date.now,
): Promise<CycleOutcome> {
  try {
    const state = await getSyncState()
    const config = state?.enabled ? transportOf(state) : null
    if (!state || config === null) return { status: 'off' }
    let session: SyncSession | null = state.session
    // The last transport error of this cycle: `suggestsPaused` reads it (an object, because a closure
    // assigns it).
    const seen: { error: SupabaseError | null } = { error: null }
    const note = async <T>(call: () => Promise<T>): Promise<T> => {
      try {
        return await call()
      } catch (error) {
        if (error instanceof SupabaseError) seen.error = error
        throw error
      }
    }
    const remote = createSyncServer(send, config, () => {
      if (session === null) throw new SyncTransportError('signedOut', SYNC_TEXT.signedOut)
      return session
    })
    const server: SyncServer = {
      push: (rows) => note(() => remote.push(rows)),
      pull: (after, limit) => note(() => remote.pull(after, limit)),
      serverTime: () => note(() => remote.serverTime()),
    }
    const result = await runSyncCycle(server, {
      now,
      onProgress: progress,
      refresh: (current) =>
        note(async () => {
          const next = await refreshSession(send, config, current, now())
          session = next
          return next
        }),
    })
    if (result.status === 'error') {
      if (result.cause !== undefined) recordError(result.cause, 'sync.cycle')
      return {
        status: 'error',
        kind: result.error.kind,
        retryAfterMs: result.retryAfterMs,
        paused: seen.error !== null && suggestsPaused(seen.error),
      }
    }
    return { status: result.status }
  } catch (error) {
    recordError(error, 'sync.cycle')
    return { status: 'error', kind: 'server', retryAfterMs: null, paused: false }
  }
}

export interface FlushDeps {
  now(): number
  /** The changes waiting, as they would be pushed. */
  pending(): Promise<readonly PushRow[]>
  /** The signed-in session and the project, or null. */
  connection(): Promise<{ session: SyncSession; config: TransportConfig } | null>
  push(
    rows: readonly PushRow[],
    connection: { session: SyncSession; config: TransportConfig },
  ): Promise<void>
}

/**
 * The push-only flush for a page that is being hidden: only when the pending rows fit in 60 KB and the
 * token is good for another minute (a refresh is not something to start while the page is going away).
 * It changes nothing locally: the entries stay in the outbox and the next cycle pushes them again, which
 * the server takes harmlessly (the same stamp from the same device is accepted). Never rejects.
 */
export async function flushPending(deps: FlushDeps): Promise<'sent' | 'nothing' | 'skipped'> {
  try {
    const rows = await deps.pending()
    if (rows.length === 0) return 'nothing'
    if (!fitsKeepalive(rows)) return 'skipped'
    const connection = await deps.connection()
    if (connection === null || tokenNeedsRefresh(connection.session.expiresAt, deps.now())) {
      return 'skipped'
    }
    await deps.push(rows, connection)
    return 'sent'
  } catch {
    return 'skipped'
  }
}

const PAGE_EVENTS: Readonly<
  Record<PageEvent, { target: 'window' | 'document'; type: string; when?: () => boolean }>
> = {
  visible: {
    target: 'document',
    type: 'visibilitychange',
    when: () => document.visibilityState === 'visible',
  },
  hidden: {
    target: 'document',
    type: 'visibilitychange',
    when: () => document.visibilityState === 'hidden',
  },
  focus: { target: 'window', type: 'focus' },
  online: { target: 'window', type: 'online' },
}

/** The browser and the data layer, for a real tab. */
export function browserPlatform(): Platform {
  const send = browserSend()
  return {
    now: () => Date.now(),
    random: () => Math.random(),
    visible: () => document.visibilityState === 'visible',
    cycle: (progress) => runOnce(send, progress),
    flush: async () => {
      await flushPending({
        now: () => Date.now(),
        pending: pendingPushRows,
        connection: async () => {
          const [session, state] = await Promise.all([getSyncSession(), getSyncState()])
          const config = transportOf(state)
          return session !== null && config !== null ? { session, config } : null
        },
        push: (rows, { session, config }) =>
          createSyncServer(send, config, () => session, { keepalive: true }).push(rows),
      })
    },
    locks: 'locks' in navigator ? navigator.locks : null,
    bus: createBus(),
    idle: (job, delayMs) => whenIdle(job, { delayMs, timeout: 3_000 }),
    on(event, fn) {
      const { target, type, when } = PAGE_EVENTS[event]
      const node: EventTarget = target === 'window' ? window : document
      const handler = (): void => {
        if (when === undefined || when()) fn()
      }
      node.addEventListener(type, handler)
      return () => node.removeEventListener(type, handler)
    },
    onWrite: onTrackedWrite,
    settleGate: settleStartupSync,
  }
}

// ─── The engine of this tab ─────────────────────────────────────────────────

let current: Engine | null = null

/**
 * Starts this tab's engine (once; a second call returns the running one). `delayMs` is how long the first
 * cycle waits after the browser is idle: the tab that turns sync on gives the other tabs a second to hear
 * that tracking is on before anything is read.
 */
export function startEngine(options: { delayMs?: number } = {}): Engine {
  if (current !== null) return current
  const engine: Engine = createEngine(browserPlatform(), {
    delayMs: options.delayMs,
    onStop: () => {
      if (current === engine) current = null
    },
  })
  current = engine
  return engine
}

/** Stops this tab's engine, if there is one. */
export function stopEngine(): void {
  current?.stop()
}

/** How long the tab that turns sync on waits before its first cycle. */
export const ENABLE_DELAY_MS = 1_000

/**
 * After a sign-in: a running engine syncs at once (the same account signing in again), a new one starts
 * after `ENABLE_DELAY_MS`.
 */
export function resumeAfterSignIn(): void {
  if (current !== null) current.syncNow()
  else startEngine({ delayMs: ENABLE_DELAY_MS })
}
