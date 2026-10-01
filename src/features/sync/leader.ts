/**
 * Who syncs when several tabs are open (PLAN §4.7.5). Supabase rotates refresh tokens, so two tabs
 * refreshing at once could sign each other out: exactly one tab runs the engine. It holds the Web Lock
 * `forge:sync` for as long as it lives, and the next tab in the queue takes over when it closes. Without
 * Web Locks every tab runs, which is the old behaviour of a browser that cannot do better.
 *
 * The tabs talk over `BroadcastChannel('forge:sync')`, the channel the tracking middleware already uses
 * (it ignores the messages below, and this ignores its `tracking` and `seen` messages):
 *  - `sync-now`: a tab that is not the leader asks the leader for a cycle (the person pressed Sync now);
 *  - `wrote`: a tab that is not the leader changed something, so the leader starts its write timer;
 *  - `nudge`: a tab that is not the leader was focused or became visible, so the leader syncs if its last
 *    cycle is old (the leader's own 5-minute rhythm pauses while the leader is hidden);
 *  - `engine?`: a tab that just started asks the leader how it is doing;
 *  - `engine`: the leader says how it is doing (running, when it tries again, a paused project, the first
 *    sync's progress), so every tab's status line is the same.
 *
 * Both pieces take what they need from the browser as arguments, so they run under a fake in tests.
 */

/** The part of `navigator.locks` leader election uses. */
export interface LockApi {
  request(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>
}

export const LOCK_NAME = 'forge:sync'
export const CHANNEL_NAME = 'forge:sync'

export interface LeaderOptions {
  /** `navigator.locks`, or null where there is none (every tab then runs). */
  locks: LockApi | null
  /** Called once with the first answer (at once for a tab that will not lead), then on every change. */
  onChange: (leader: boolean) => void
}

export interface Leader {
  /** Joins the election. Safe to call twice. */
  start(): void
  /** Leaves it: releases the lock if held, and gives up a place in the queue. Safe to call twice. */
  stop(): void
  readonly isLeader: boolean
}

/**
 * Takes the lock without waiting first, so a tab that will not lead knows it at once (the start-up gate
 * must not wait for a tab that never syncs), then queues for it. The lock is held by a promise that only
 * `stop()` settles; closing the tab releases it too.
 */
export function createLeader({ locks, onChange }: LeaderOptions): Leader {
  let started = false
  let stopped = false
  let leading = false
  let release: (() => void) | null = null
  const abort = new AbortController()

  const set = (next: boolean): void => {
    if (next === leading) return
    leading = next
    onChange(next)
  }
  const hold = (): Promise<void> => {
    if (stopped) return Promise.resolve()
    set(true)
    return new Promise<void>((resolve) => {
      release = () => {
        release = null
        resolve()
      }
    })
  }
  // An aborted request rejects with an AbortError: that is how a queued tab leaves, not an error.
  const ignore = (): void => undefined

  return {
    start() {
      if (started) return
      started = true
      if (locks === null) {
        set(true)
        return
      }
      locks
        .request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
          if (lock !== null) return hold()
          onChange(false)
          await locks.request(LOCK_NAME, { signal: abort.signal }, () => hold()).catch(ignore)
        })
        .catch(ignore)
    },
    stop() {
      if (stopped) return
      stopped = true
      abort.abort()
      release?.()
      set(false)
    },
    get isLeader() {
      return leading
    },
  }
}

// ─── The channel ────────────────────────────────────────────────────────────

/** What the leader shares about itself. */
export interface EngineShare {
  running: boolean
  /** When it tries again after a failure. */
  retryAt: number | null
  /** Repeated 5xx / 540 answers: the project may be paused. */
  paused: boolean
  /** The first sync's step and count. */
  progress: { step: string; rows: number } | null
}

export type SyncMessage =
  | { type: 'sync-now' }
  | { type: 'wrote' }
  | { type: 'nudge' }
  | { type: 'engine?' }
  | { type: 'engine'; state: EngineShare }

export interface Bus {
  post(message: SyncMessage): void
  listen(fn: (message: SyncMessage) => void): () => void
  close(): void
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** A message from the channel, or null for anything else (the tracking middleware shares the channel). */
export function readMessage(value: unknown): SyncMessage | null {
  if (!isObj(value)) return null
  if (value.type === 'sync-now') return { type: 'sync-now' }
  if (value.type === 'wrote') return { type: 'wrote' }
  if (value.type === 'nudge') return { type: 'nudge' }
  if (value.type === 'engine?') return { type: 'engine?' }
  if (value.type !== 'engine' || !isObj(value.state)) return null
  const { running, retryAt, paused, progress } = value.state
  if (typeof running !== 'boolean' || typeof paused !== 'boolean') return null
  if (retryAt !== null && (typeof retryAt !== 'number' || !Number.isFinite(retryAt))) return null
  let shared: EngineShare['progress'] = null
  if (progress !== null && progress !== undefined) {
    if (!isObj(progress) || typeof progress.step !== 'string') return null
    if (typeof progress.rows !== 'number' || !Number.isFinite(progress.rows)) return null
    shared = { step: progress.step, rows: progress.rows }
  }
  return { type: 'engine', state: { running, retryAt, paused, progress: shared } }
}

/** The channel, or null where the browser has no BroadcastChannel. */
export function createBus(): Bus | null {
  if (typeof BroadcastChannel !== 'function') return null
  const channel = new BroadcastChannel(CHANNEL_NAME)
  return {
    post: (message) => channel.postMessage(message),
    listen(fn) {
      const handler = (e: MessageEvent<unknown>): void => {
        const message = readMessage(e.data)
        if (message !== null) fn(message)
      }
      channel.addEventListener('message', handler)
      return () => channel.removeEventListener('message', handler)
    },
    close: () => channel.close(),
  }
}
