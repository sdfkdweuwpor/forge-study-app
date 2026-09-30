/**
 * The app's line to the Forge extension (PLAN §1.4): `chrome.runtime.sendMessage(extensionId, message)`,
 * which Chrome only offers to pages the extension lists in `externally_connectable` (the deployed site,
 * localhost and 127.0.0.1). Everything else means "not reachable": no `chrome.runtime.sendMessage` at
 * all (another browser, an origin the extension does not list, no extension), a `lastError` (the id is
 * wrong, the extension is off), or no answer within 1.5 s.
 *
 * Nothing here throws. Each call resolves to a `BridgeResult`, so the sync provider and the page can
 * treat "the extension isn't there" as an ordinary, silent outcome. Messages are checked with the
 * protocol's own guards before they are sent, and replies are checked before they are believed.
 */
import { getSettings } from '@/db/repos/settings'
import { DEFAULT_EXTENSION_ID } from '@/config'
import {
  PROTOCOL_VERSION,
  isAppMessage,
  isBlockEvent,
  type AppMessage,
  type BlockEvent,
  type BlockerConfig,
  type SessionState,
} from '@ext/protocol'

export const BRIDGE_TIMEOUT_MS = 1_500

/** Why a call did not get an answer it could use. */
export type BridgeFailure =
  /** No `chrome.runtime.sendMessage` on this page: no Chrome extension API to talk through. */
  | 'no-runtime'
  /** Chrome reported an error (`lastError`), or `sendMessage` threw: the id is wrong or the extension is off. */
  | 'unreachable'
  | 'timeout'
  /** The extension answered `{ ok: false }`, e.g. "Unauthorized origin". */
  | 'rejected'
  /** The answer wasn't in the shape the protocol promises, or the message itself was malformed. */
  | 'invalid'

export type BridgeResult<T> =
  { ok: true; value: T } | { ok: false; reason: BridgeFailure; message: string }

/** The one `chrome.runtime` call the app makes (the app declares its own type so `@types/chrome` stays out of it). */
export interface ChromeRuntimeLike {
  sendMessage?: (
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void,
  ) => void
  lastError?: { message?: string } | undefined
}

interface ChromeGlobal {
  chrome?: { runtime?: ChromeRuntimeLike }
}

export interface SendOptions {
  /** Defaults to the settings' override, then the built-in id. */
  extensionId?: string
  timeoutMs?: number
  /** Where to look for `chrome.runtime`. Tests pass a stand-in; the app uses `globalThis`. */
  runtime?: ChromeRuntimeLike | null
}

function currentRuntime(): ChromeRuntimeLike | null {
  return (globalThis as unknown as ChromeGlobal).chrome?.runtime ?? null
}

/** The extension id in use: the override from the Blocker page, else the built-in one. */
export async function resolveExtensionId(): Promise<string> {
  try {
    const { blocker } = await getSettings()
    return blocker.extensionIdOverride ?? DEFAULT_EXTENSION_ID
  } catch {
    return DEFAULT_EXTENSION_ID
  }
}

const fail = (
  reason: BridgeFailure,
  message: string,
): { ok: false; reason: BridgeFailure; message: string } => ({
  ok: false,
  reason,
  message,
})

/** True when this page can talk to extensions at all. */
export function hasExtensionRuntime(runtime: ChromeRuntimeLike | null = currentRuntime()): boolean {
  return typeof runtime?.sendMessage === 'function'
}

/**
 * Sends one message and resolves to the extension's raw reply. Never rejects: a missing API, a
 * `lastError`, a thrown call and a silent extension each become a failure result. Only the first
 * outcome counts (a late reply after the timeout is ignored).
 */
export function sendToExtension(
  message: AppMessage,
  options: SendOptions = {},
): Promise<BridgeResult<unknown>> {
  const runtime = options.runtime === undefined ? currentRuntime() : options.runtime
  if (!isAppMessage(message)) {
    return Promise.resolve(fail('invalid', 'The message is not valid protocol data.'))
  }
  const send = runtime?.sendMessage
  if (runtime === null || typeof send !== 'function') {
    return Promise.resolve(fail('no-runtime', 'This page cannot reach a browser extension.'))
  }
  const timeoutMs = options.timeoutMs ?? BRIDGE_TIMEOUT_MS

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: BridgeResult<unknown>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(
      () => finish(fail('timeout', 'The extension did not answer.')),
      timeoutMs,
    )
    const run = async () => {
      let extensionId: string
      try {
        extensionId = options.extensionId ?? (await resolveExtensionId())
        send.call(runtime, extensionId, message, (response: unknown) => {
          // Reading lastError inside the callback is what tells Chrome the error was handled.
          const error = runtime.lastError
          if (error)
            finish(fail('unreachable', error.message ?? 'The extension could not be reached.'))
          else finish({ ok: true, value: response })
        })
      } catch (e) {
        finish(
          fail(
            'unreachable',
            e instanceof Error ? e.message : 'The extension could not be reached.',
          ),
        )
      }
    }
    void run()
  })
}

// ─── Replies ────────────────────────────────────────────────────────────────

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** Reads `{ ok: true, … }` from a reply, or turns `{ ok: false, error }` and junk into a failure. */
function accepted(result: BridgeResult<unknown>): BridgeResult<Record<string, unknown>> {
  if (!result.ok) return result
  const reply = result.value
  if (!isRecord(reply) || typeof reply['ok'] !== 'boolean') {
    return fail('invalid', 'The extension sent a reply the app does not understand.')
  }
  if (reply['ok'] !== true) {
    const error = reply['error']
    return fail(
      'rejected',
      typeof error === 'string' && error !== '' ? error : 'The extension refused the request.',
    )
  }
  return { ok: true, value: reply }
}

export interface ExtensionInfo {
  version: string
}

/** Is the extension there? Resolves with its version. */
export async function ping(options: SendOptions = {}): Promise<BridgeResult<ExtensionInfo>> {
  const reply = accepted(await sendToExtension({ v: PROTOCOL_VERSION, type: 'ping' }, options))
  if (!reply.ok) return reply
  const version = reply.value['version']
  return {
    ok: true,
    value: { version: typeof version === 'string' && version !== '' ? version : 'unknown' },
  }
}

/** Gives the extension the whole blocker config. */
export async function pushConfig(
  config: BlockerConfig,
  options: SendOptions = {},
): Promise<BridgeResult<null>> {
  const reply = accepted(
    await sendToExtension({ v: PROTOCOL_VERSION, type: 'sync', config }, options),
  )
  return reply.ok ? { ok: true, value: null } : reply
}

/** Tells the extension whether a focus session is running (and when it ends), or `null` when none is. */
export async function pushSession(
  session: SessionState | null,
  options: SendOptions = {},
): Promise<BridgeResult<null>> {
  const reply = accepted(
    await sendToExtension({ v: PROTOCOL_VERSION, type: 'session', session }, options),
  )
  return reply.ok ? { ok: true, value: null } : reply
}

export interface EventsReply {
  events: BlockEvent[]
  /** Pass this back as `since` next time. */
  cursor: number
}

/** Asks for the events recorded after `since` (an `at` cursor; 0 = all of them). */
export async function pullEvents(
  since: number,
  options: SendOptions = {},
): Promise<BridgeResult<EventsReply>> {
  const reply = accepted(
    await sendToExtension(
      { v: PROTOCOL_VERSION, type: 'getEvents', since: Math.max(0, since) },
      options,
    ),
  )
  if (!reply.ok) return reply
  const { events, cursor } = reply.value
  if (!Array.isArray(events) || typeof cursor !== 'number' || !Number.isFinite(cursor)) {
    return fail('invalid', 'The extension sent events in an unexpected shape.')
  }
  // One bad record must not lose the good ones: keep what passes the guard.
  return { ok: true, value: { events: events.filter(isBlockEvent), cursor } }
}
