import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EXTENSION_ID } from '@/config'
import type { BlockerConfig } from '@ext/protocol'
import {
  BRIDGE_TIMEOUT_MS,
  hasExtensionRuntime,
  ping,
  pullEvents,
  pushConfig,
  pushSession,
  sendToExtension,
  type ChromeRuntimeLike,
} from './bridge'

const ID = 'abcdefghijklmnopabcdefghijklmnop'
const CONFIG: BlockerConfig = {
  mode: 'focus',
  blocklist: ['instagram.com'],
  allowlist: [],
  schedule: [],
  motivation: ['One unit at a time.'],
}

/** A runtime whose extension answers `reply` (or fails the way Chrome does) after `delayMs`. */
function runtime(
  behave: (message: unknown, respond: (r: unknown) => void, self: ChromeRuntimeLike) => void,
): ChromeRuntimeLike & { calls: { id: string; message: unknown }[] } {
  const calls: { id: string; message: unknown }[] = []
  const self: ChromeRuntimeLike & { calls: typeof calls } = {
    calls,
    lastError: undefined,
    sendMessage(id, message, callback) {
      calls.push({ id, message })
      behave(message, callback, self)
    },
  }
  return self
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(globalThis, 'chrome')
})

describe('sendToExtension', () => {
  it('sends the message to the given extension id and resolves with the reply', async () => {
    const rt = runtime((_m, respond) => respond({ ok: true, version: '1.0.0' }))
    const result = await sendToExtension({ v: 1, type: 'ping' }, { runtime: rt, extensionId: ID })
    expect(result).toEqual({ ok: true, value: { ok: true, version: '1.0.0' } })
    expect(rt.calls).toEqual([{ id: ID, message: { v: 1, type: 'ping' } }])
  })

  it('is not reachable when there is no chrome.runtime.sendMessage', async () => {
    for (const rt of [null, {}, { sendMessage: undefined }] as (ChromeRuntimeLike | null)[]) {
      expect(
        await sendToExtension({ v: 1, type: 'ping' }, { runtime: rt, extensionId: ID }),
      ).toMatchObject({
        ok: false,
        reason: 'no-runtime',
      })
    }
  })

  it('reads chrome.runtime from the global by default', async () => {
    expect(hasExtensionRuntime()).toBe(false)
    expect(await sendToExtension({ v: 1, type: 'ping' }, { extensionId: ID })).toMatchObject({
      reason: 'no-runtime',
    })
    const rt = runtime((_m, respond) => respond({ ok: true }))
    ;(globalThis as unknown as { chrome: { runtime: ChromeRuntimeLike } }).chrome = { runtime: rt }
    expect(hasExtensionRuntime()).toBe(true)
    expect((await sendToExtension({ v: 1, type: 'ping' }, { extensionId: ID })).ok).toBe(true)
  })

  it('reports lastError (wrong id, extension off) as unreachable', async () => {
    const rt = runtime((_m, respond, self) => {
      self.lastError = { message: 'Could not establish connection. Receiving end does not exist.' }
      respond(undefined)
    })
    expect(await sendToExtension({ v: 1, type: 'ping' }, { runtime: rt, extensionId: ID })).toEqual(
      {
        ok: false,
        reason: 'unreachable',
        message: 'Could not establish connection. Receiving end does not exist.',
      },
    )
  })

  it('treats a synchronous throw (an invalid id) as unreachable', async () => {
    const rt = runtime(() => {
      throw new Error('Invalid extension id')
    })
    expect(
      await sendToExtension({ v: 1, type: 'ping' }, { runtime: rt, extensionId: 'bad' }),
    ).toMatchObject({
      ok: false,
      reason: 'unreachable',
      message: 'Invalid extension id',
    })
  })

  it('gives up after 1.5 seconds of silence, and ignores a late reply', async () => {
    let late: ((r: unknown) => void) | undefined
    const rt = runtime((_m, respond) => {
      late = respond
    })
    const pending = sendToExtension({ v: 1, type: 'ping' }, { runtime: rt, extensionId: ID })
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(BRIDGE_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toMatchObject({ ok: false, reason: 'timeout' })
    late?.({ ok: true })
    expect(await pending).toMatchObject({ reason: 'timeout' })
  })

  it('the timeout is 1.5 s and can be changed', async () => {
    expect(BRIDGE_TIMEOUT_MS).toBe(1500)
    const rt = runtime(() => undefined)
    const pending = sendToExtension(
      { v: 1, type: 'ping' },
      { runtime: rt, extensionId: ID, timeoutMs: 50 },
    )
    await vi.advanceTimersByTimeAsync(50)
    expect(await pending).toMatchObject({ reason: 'timeout' })
  })

  it('a reply in time cancels the timer', async () => {
    const rt = runtime((_m, respond) => setTimeout(() => respond({ ok: true }), 100))
    const pending = sendToExtension({ v: 1, type: 'ping' }, { runtime: rt, extensionId: ID })
    await vi.advanceTimersByTimeAsync(100)
    expect((await pending).ok).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never sends a message the protocol would reject', async () => {
    const rt = runtime((_m, respond) => respond({ ok: true }))
    const bad = { v: 1, type: 'sync', config: { mode: 'nope' } } as never
    expect(await sendToExtension(bad, { runtime: rt, extensionId: ID })).toMatchObject({
      reason: 'invalid',
    })
    expect(rt.calls).toHaveLength(0)
  })
})

describe('typed wrappers', () => {
  it('ping resolves with the version', async () => {
    const rt = runtime((_m, respond) => respond({ ok: true, version: '1.0.0' }))
    expect(await ping({ runtime: rt, extensionId: ID })).toEqual({
      ok: true,
      value: { version: '1.0.0' },
    })
  })

  it('ping without a version still means connected', async () => {
    const rt = runtime((_m, respond) => respond({ ok: true }))
    expect(await ping({ runtime: rt, extensionId: ID })).toEqual({
      ok: true,
      value: { version: 'unknown' },
    })
  })

  it('an { ok: false } reply is a rejection with the extension’s words', async () => {
    const rt = runtime((_m, respond) => respond({ ok: false, error: 'Unauthorized origin' }))
    expect(await ping({ runtime: rt, extensionId: ID })).toEqual({
      ok: false,
      reason: 'rejected',
      message: 'Unauthorized origin',
    })
  })

  it('a reply that is not a protocol reply is invalid', async () => {
    for (const junk of [undefined, null, 'ok', 42, [], {}, { ok: 'yes' }]) {
      const rt = runtime((_m, respond) => respond(junk))
      expect(await ping({ runtime: rt, extensionId: ID })).toMatchObject({
        ok: false,
        reason: 'invalid',
      })
    }
  })

  it('pushConfig sends a sync message', async () => {
    const rt = runtime((_m, respond) => respond({ ok: true }))
    expect(await pushConfig(CONFIG, { runtime: rt, extensionId: ID })).toEqual({
      ok: true,
      value: null,
    })
    expect(rt.calls[0]?.message).toEqual({ v: 1, type: 'sync', config: CONFIG })
  })

  it('pushSession sends a session, or null to clear it', async () => {
    const rt = runtime((_m, respond) => respond({ ok: true }))
    const session = { active: true, endsAt: 123, taskTitle: 'Read chapter 4' }
    await pushSession(session, { runtime: rt, extensionId: ID })
    await pushSession(null, { runtime: rt, extensionId: ID })
    expect(rt.calls.map((c) => c.message)).toEqual([
      { v: 1, type: 'session', session },
      { v: 1, type: 'session', session: null },
    ])
  })

  it('pullEvents asks since the cursor and keeps only valid events', async () => {
    const good = { id: 'a', at: 5, kind: 'blocked', domain: 'reddit.com' }
    const rt = runtime((_m, respond) =>
      respond({ ok: true, events: [good, { id: 'x', kind: 'nope' }, 7], cursor: 5 }),
    )
    expect(await pullEvents(3, { runtime: rt, extensionId: ID })).toEqual({
      ok: true,
      value: { events: [good], cursor: 5 },
    })
    expect(rt.calls[0]?.message).toEqual({ v: 1, type: 'getEvents', since: 3 })
  })

  it('pullEvents without events or a cursor is invalid', async () => {
    const rt = runtime((_m, respond) => respond({ ok: true }))
    expect(await pullEvents(0, { runtime: rt, extensionId: ID })).toMatchObject({
      reason: 'invalid',
    })
  })

  it('a negative cursor is sent as 0', async () => {
    const rt = runtime((_m, respond) => respond({ ok: true, events: [], cursor: 0 }))
    await pullEvents(-5, { runtime: rt, extensionId: ID })
    expect(rt.calls[0]?.message).toEqual({ v: 1, type: 'getEvents', since: 0 })
  })
})

describe('the extension id', () => {
  it('defaults to the built-in id (no override stored) and uses the override when there is one', async () => {
    vi.useRealTimers()
    const { db } = await import('@/db/db')
    const { ensureSettings, updateSettings } = await import('@/db/repos/settings')
    await Promise.all(db.tables.map((t) => t.clear()))
    await ensureSettings()
    const rt = runtime((_m, respond) => respond({ ok: true }))
    await sendToExtension({ v: 1, type: 'ping' }, { runtime: rt })
    await updateSettings({ blocker: { extensionIdOverride: ID } })
    await sendToExtension({ v: 1, type: 'ping' }, { runtime: rt })
    expect(rt.calls.map((c) => c.id)).toEqual([DEFAULT_EXTENSION_ID, ID])
  })
})
