/**
 * Service worker: the single place that writes `chrome.storage.local` and the DNR rules. Everything
 * that changes state (app messages, blocked-page events, alarms) goes through `mutate`, which runs
 * one change at a time, so two writers can never read the same old state and overwrite each other.
 * The pure decisions live in ../shared and ./rules; this file is the thin chrome.* shell.
 */
import { isInternalMessage, type InternalMessage, type InternalResponse } from '../shared/internal.js'
import { isAllowedOrigin } from '../shared/origins.js'
import { isAppMessage, type AppMessage, type AppResponse } from '../shared/protocol.js'
import {
  eventsSince,
  grantUnlock,
  hasActiveUnlock,
  isBlockedDomain,
  isBlockingNow,
  nextRefreshAt,
  pruneUnlocks,
  recordBlocked,
  type ExtensionState,
} from '../shared/state.js'
import { loadState, saveChanges } from '../lib/store.js'
import { buildRules } from './rules.js'

const REFRESH_ALARM = 'forge-refresh'

let queue: Promise<unknown> = Promise.resolve()

/** Runs `task` after every earlier task has finished, whether they succeeded or failed. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task)
  queue = run.catch(() => undefined)
  return run
}

/** Replaces the DNR rules with what `state` calls for right now, and schedules the next rebuild. */
async function applyRules(state: ExtensionState, now: number): Promise<void> {
  const rules = buildRules(state, now, chrome.runtime.getURL(''))
  const current = await chrome.declarativeNetRequest.getDynamicRules()
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: current.map((r) => r.id),
    addRules: rules,
  })
  const next = nextRefreshAt(state, now)
  if (next === null) await chrome.alarms.clear(REFRESH_ALARM)
  else await chrome.alarms.create(REFRESH_ALARM, { when: next })
}

/**
 * Loads the state, applies `change` (return null to reject it), saves what changed, and rebuilds
 * the rules. Resolves to the new state, or null when the change was rejected.
 */
function mutate(change: (state: ExtensionState, now: number) => ExtensionState | null): Promise<ExtensionState | null> {
  return enqueue(async () => {
    const now = Date.now()
    const previous = await loadState()
    const changed = change(previous, now)
    if (changed === null) return null
    const next = pruneUnlocks(changed, now)
    await saveChanges(previous, next)
    await applyRules(next, now)
    return next
  })
}

/** Rebuilds the rules from what is stored (startup, alarms). */
function refresh(): Promise<ExtensionState | null> {
  return mutate((state) => state)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function handleAppMessage(message: AppMessage): Promise<AppResponse> {
  switch (message.type) {
    case 'ping':
      return { ok: true, version: chrome.runtime.getManifest().version }
    case 'sync':
      await mutate((state) => ({ ...state, config: message.config }))
      return { ok: true }
    case 'session':
      await mutate((state) => ({ ...state, session: message.session }))
      return { ok: true }
    case 'getEvents': {
      const { events } = await loadState()
      return { ok: true, ...eventsSince(events, message.since) }
    }
  }
}

/** The app (Netlify origin or localhost) talking to the extension. */
chrome.runtime.onMessageExternal.addListener((message: unknown, sender, sendResponse) => {
  if (!isAllowedOrigin(sender.url)) {
    sendResponse({ ok: false, error: 'Unauthorized origin' } satisfies AppResponse)
    return false
  }
  if (!isAppMessage(message)) {
    sendResponse({ ok: false, error: 'Malformed or unsupported message' } satisfies AppResponse)
    return false
  }
  handleAppMessage(message).then(sendResponse, (err: unknown) =>
    sendResponse({ ok: false, error: errorMessage(err) } satisfies AppResponse),
  )
  return true
})

/** Is the sender our own blocked page, in the top frame of a tab? Only that page may log attempts and unlock. */
function isBlockedPage(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url) return false
  if (sender.frameId !== undefined && sender.frameId !== 0) return false
  try {
    const url = new URL(sender.url)
    return url.origin === new URL(chrome.runtime.getURL('')).origin && url.pathname === '/blocked.html'
  } catch {
    return false
  }
}

async function handleInternalMessage(message: InternalMessage): Promise<InternalResponse> {
  const id = crypto.randomUUID()
  const domain = message.domain
  const applied = await mutate((state, now) => {
    // Only real blocklist domains, and only while they are really blocked: a crafted URL cannot inflate the log.
    if (!isBlockedDomain(state, domain)) return null
    if (message.type === 'internal:blocked') {
      return isBlockingNow(state, now) && !hasActiveUnlock(state, domain, now)
        ? recordBlocked(state, domain, id, now)
        : null
    }
    return grantUnlock(state, domain, id, now)
  })
  return applied === null ? { ok: false, error: 'Not applied' } : { ok: true }
}

/** The extension's own pages (blocked.html) asking the worker to write. */
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isInternalMessage(message)) return false
  if (!isBlockedPage(sender)) {
    sendResponse({ ok: false, error: 'Not allowed from this page' } satisfies InternalResponse)
    return false
  }
  handleInternalMessage(message).then(sendResponse, (err: unknown) =>
    sendResponse({ ok: false, error: errorMessage(err) } satisfies InternalResponse),
  )
  return true
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) void refresh()
})

chrome.runtime.onInstalled.addListener(() => {
  void refresh()
})

// Alarms are not guaranteed to survive a browser restart, so rebuild then too.
chrome.runtime.onStartup.addListener(() => {
  void refresh()
})
