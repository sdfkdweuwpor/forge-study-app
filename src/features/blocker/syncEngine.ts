/**
 * The sync loop between the app and the extension, without React or the DOM so it can be tested with
 * fake timers and a fake bridge. `BlockerSync` feeds it the current config and focus session and asks
 * it to pull; `sync.ts` wires it to the real bridge and database.
 *
 * Behaviour, in one place:
 * - A changed config or session is pushed after a short debounce (config 400 ms, session 120 ms), and
 *   only when it differs from what the extension last received.
 * - Whenever contact is (re)established, everything is pushed again: the extension may have been
 *   reinstalled and be running its defaults.
 * - `pull()` pings, pushes anything pending, then reads the events after the stored cursor and merges
 *   them. Calls run one at a time, in order.
 * - It never throws and never complains when the extension is absent: that is just a status.
 */
import type { BlockerConfig, SessionState } from '@ext/protocol'
import type { BridgeFailure, BridgeResult, EventsReply, ExtensionInfo } from './bridge'

export interface SyncDeps {
  ping(): Promise<BridgeResult<ExtensionInfo>>
  pushConfig(config: BlockerConfig): Promise<BridgeResult<null>>
  pushSession(session: SessionState | null): Promise<BridgeResult<null>>
  pullEvents(since: number): Promise<BridgeResult<EventsReply>>
  /** Where the last pull stopped. */
  readCursor(): Promise<number>
  /** Saves pulled events and moves the cursor. Must be idempotent. */
  storeEvents(reply: EventsReply): Promise<void>
  /** The extension has the current config. */
  markSynced(): Promise<void>
  now(): number
  setConnected(version: string, at: number): void
  setUnavailable(reason: BridgeFailure, message: string, at: number): void
  /** Something went wrong that is not "the extension is absent" (a database error). */
  report(error: unknown, detail: string): void
  configDelayMs?: number
  sessionDelayMs?: number
}

export interface SyncEngine {
  /** The config the extension should have. `null` = not known yet (nothing is pushed). */
  setConfig(config: BlockerConfig | null): void
  /** The focus session, or `null` when none runs. Call it once the session is known. */
  setSession(session: SessionState | null): void
  /** Ping, push what is pending, and pull events. */
  pull(): Promise<void>
  /** Ping and push what is pending, without pulling events (the page's "Check again"). */
  check(): Promise<void>
  /** Cancels pending debounced pushes (they are re-scheduled by the next `setConfig` / `setSession`). */
  cancelPending(): void
}

export function createSyncEngine(deps: SyncDeps): SyncEngine {
  const configDelay = deps.configDelayMs ?? 400
  const sessionDelay = deps.sessionDelayMs ?? 120

  let config: BlockerConfig | null = null
  let configKey: string | null = null
  let pushedConfigKey: string | null = null
  let session: SessionState | null = null
  let sessionKnown = false
  let sessionKey: string | null = null
  let pushedSessionKey: string | null = null
  let connected = false
  let configTimer: ReturnType<typeof setTimeout> | undefined
  let sessionTimer: ReturnType<typeof setTimeout> | undefined
  let queue: Promise<unknown> = Promise.resolve()

  const enqueue = (task: () => Promise<void>, detail: string): Promise<void> => {
    const run = queue.then(task).catch((e: unknown) => deps.report(e, detail))
    queue = run
    return run
  }

  const lost = (r: { reason: BridgeFailure; message: string }): void => {
    connected = false
    deps.setUnavailable(r.reason, r.message, deps.now())
  }

  async function flushConfig(): Promise<void> {
    if (config === null || configKey === null || configKey === pushedConfigKey) return
    const key = configKey
    const r = await deps.pushConfig(config)
    if (!r.ok) return lost(r)
    pushedConfigKey = key
    await deps.markSynced().catch((e: unknown) => deps.report(e, 'blocker.markSynced'))
  }

  async function flushSession(): Promise<void> {
    if (!sessionKnown || sessionKey === null || sessionKey === pushedSessionKey) return
    const key = sessionKey
    const r = await deps.pushSession(session)
    if (!r.ok) return lost(r)
    pushedSessionKey = key
  }

  /** Pings; on success makes sure the extension has the latest config and session. */
  async function connect(): Promise<boolean> {
    const r = await deps.ping()
    if (!r.ok) {
      lost(r)
      return false
    }
    if (!connected) {
      // First contact, or contact again after losing it: the extension may be running its defaults.
      pushedConfigKey = null
      pushedSessionKey = null
    }
    connected = true
    deps.setConnected(r.value.version, deps.now())
    await flushConfig()
    if (connected) await flushSession()
    return connected
  }

  const debounced = (kind: 'config' | 'session'): void => {
    if (kind === 'config') {
      clearTimeout(configTimer)
      configTimer = setTimeout(() => {
        void enqueue(
          () => (connected ? flushConfig() : connect().then(() => undefined)),
          'blocker.pushConfig',
        )
      }, configDelay)
    } else {
      clearTimeout(sessionTimer)
      sessionTimer = setTimeout(() => {
        void enqueue(
          () => (connected ? flushSession() : connect().then(() => undefined)),
          'blocker.pushSession',
        )
      }, sessionDelay)
    }
  }

  return {
    setConfig(next) {
      config = next
      configKey = next === null ? null : JSON.stringify(next)
      if (next !== null) debounced('config')
    },
    setSession(next) {
      session = next
      sessionKnown = true
      sessionKey = JSON.stringify(next)
      debounced('session')
    },
    check() {
      return enqueue(async () => {
        await connect()
      }, 'blocker.check')
    },
    pull() {
      return enqueue(async () => {
        if (!(await connect())) return
        const since = await deps.readCursor()
        const r = await deps.pullEvents(since)
        if (!r.ok) return lost(r)
        await deps.storeEvents(r.value)
      }, 'blocker.pull')
    },
    cancelPending() {
      clearTimeout(configTimer)
      clearTimeout(sessionTimer)
    },
  }
}
