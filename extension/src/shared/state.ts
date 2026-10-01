/**
 * The extension's persisted state and every rule about it, as pure functions. `chrome.storage` is
 * only touched by `lib/store.ts` and `background/sw.ts`, so all of this runs (and is tested) in
 * plain Node.
 */
import { normalizeBlocklist } from './domains.js'
import {
  isBlockEvent,
  isBlockerConfig,
  isSessionState,
  type BlockEvent,
  type BlockerConfig,
  type SessionState,
} from './protocol.js'
import { isScheduleActive, nextScheduleBoundary } from './schedule.js'
import { localDayKey } from './time.js'

export interface Unlock {
  domain: string
  /** Epoch ms when the 5 minutes run out. */
  until: number
}

export interface DailyAttempts {
  /** Local `YYYY-MM-DD`. */
  date: string
  count: number
}

export interface ExtensionState {
  config: BlockerConfig
  session: SessionState | null
  unlocks: Unlock[]
  /** Oldest first, `at` strictly increasing. */
  events: BlockEvent[]
  dailyAttempts: DailyAttempts
}

/** Keys of `chrome.storage.local`, one per field of `ExtensionState`. */
export const STATE_KEYS = ['config', 'session', 'unlocks', 'events', 'dailyAttempts'] as const

export const MAX_EVENTS = 5000
export const UNLOCK_MINUTES = 5

export const DEFAULT_BLOCKLIST: readonly string[] = [
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'x.com',
  'twitter.com',
  'reddit.com',
  'facebook.com',
  'snapchat.com',
  'netflix.com',
  'twitch.tv',
  'pinterest.com',
]

export function defaultConfig(): BlockerConfig {
  return {
    mode: 'always',
    blocklist: [...DEFAULT_BLOCKLIST],
    allowlist: [],
    schedule: [],
    motivation: [
      'Future you is already grateful.',
      'One focused hour beats a distracted evening.',
      'Back to the thing that matters.',
    ],
  }
}

export function defaultState(): ExtensionState {
  return {
    config: defaultConfig(),
    session: null,
    unlocks: [],
    events: [],
    dailyAttempts: { date: '', count: 0 },
  }
}

function isUnlock(x: unknown): x is Unlock {
  if (typeof x !== 'object' || x === null) return false
  const u = x as Record<string, unknown>
  return (
    typeof u['domain'] === 'string' && typeof u['until'] === 'number' && Number.isFinite(u['until'])
  )
}

function isDailyAttempts(x: unknown): x is DailyAttempts {
  if (typeof x !== 'object' || x === null) return false
  const a = x as Record<string, unknown>
  return (
    typeof a['date'] === 'string' &&
    typeof a['count'] === 'number' &&
    Number.isInteger(a['count']) &&
    a['count'] >= 0
  )
}

/** Reads whatever `chrome.storage.local` returned into a valid state; anything malformed falls back to its default. */
export function normalizeState(raw: unknown): ExtensionState {
  const stored = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const defaults = defaultState()
  const events = Array.isArray(stored['events'])
    ? stored['events'].filter(isBlockEvent)
    : defaults.events
  return {
    config: isBlockerConfig(stored['config']) ? stored['config'] : defaults.config,
    session: isSessionState(stored['session']) ? stored['session'] : null,
    unlocks: Array.isArray(stored['unlocks'])
      ? stored['unlocks'].filter(isUnlock)
      : defaults.unlocks,
    events: events.slice(-MAX_EVENTS),
    dailyAttempts: isDailyAttempts(stored['dailyAttempts'])
      ? stored['dailyAttempts']
      : defaults.dailyAttempts,
  }
}

/** The session, but only while it is really running: flagged active and not past its end. */
export function activeSession(state: ExtensionState, now: number): SessionState | null {
  const s = state.session
  return s !== null && s.active && (s.endsAt === null || s.endsAt > now) ? s : null
}

/** Whether redirects should be installed right now, for the configured mode. */
export function isBlockingNow(state: ExtensionState, now: number): boolean {
  switch (state.config.mode) {
    case 'always':
      return true
    case 'focus':
      return activeSession(state, now) !== null
    case 'schedule':
      return isScheduleActive(state.config.schedule, now)
  }
}

export function hasActiveUnlock(state: ExtensionState, domain: string, now: number): boolean {
  return state.unlocks.some((u) => u.domain === domain && u.until > now)
}

/** Is `domain` (as sent by a page) one of the blocklist's domains? Guards the log and unlocks against crafted URLs. */
export function isBlockedDomain(state: ExtensionState, domain: string): boolean {
  return normalizeBlocklist(state.config.blocklist).includes(domain)
}

/**
 * The next moment the rules must be rebuilt: an unlock running out, a session ending, or (in
 * schedule mode) a window opening or closing. Null when nothing will change by itself.
 */
export function nextRefreshAt(state: ExtensionState, now: number): number | null {
  const times: number[] = []
  for (const u of state.unlocks) if (u.until > now) times.push(u.until)
  const session = activeSession(state, now)
  if (session?.endsAt) times.push(session.endsAt)
  if (state.config.mode === 'schedule') {
    const boundary = nextScheduleBoundary(state.config.schedule, now)
    if (boundary !== null) times.push(boundary)
  }
  return times.length > 0 ? Math.min(...times) : null
}

/** Drops unlocks that have run out. Returns the same array when nothing expired. */
export function pruneUnlocks(state: ExtensionState, now: number): ExtensionState {
  const live = state.unlocks.filter((u) => u.until > now)
  return live.length === state.unlocks.length ? state : { ...state, unlocks: live }
}

/**
 * Appends an event. `at` is the time of the write but always greater than the previous event's, so
 * two events never share a timestamp and a `since` cursor can never skip one. The oldest events
 * beyond MAX_EVENTS are dropped.
 */
export function appendEvent(
  state: ExtensionState,
  event: Omit<BlockEvent, 'at'>,
  now: number,
): ExtensionState {
  const last = state.events[state.events.length - 1]
  const at = last !== undefined && last.at >= now ? last.at + 1 : now
  return { ...state, events: [...state.events, { ...event, at }].slice(-MAX_EVENTS) }
}

/** A blocked page loaded: logs it and counts it towards today's wins (a local day, reset at local midnight). */
export function recordBlocked(
  state: ExtensionState,
  domain: string,
  id: string,
  now: number,
): ExtensionState {
  const today = localDayKey(now)
  const previous = state.dailyAttempts.date === today ? state.dailyAttempts.count : 0
  const next = appendEvent(state, { id, kind: 'blocked', domain }, now)
  return { ...next, dailyAttempts: { date: today, count: previous + 1 } }
}

/** Grants UNLOCK_MINUTES of access to `domain` (replacing an earlier grant) and logs it. */
export function grantUnlock(
  state: ExtensionState,
  domain: string,
  id: string,
  now: number,
): ExtensionState {
  const unlocks = [
    ...state.unlocks.filter((u) => u.until > now && u.domain !== domain),
    { domain, until: now + UNLOCK_MINUTES * 60_000 },
  ]
  return appendEvent(
    { ...state, unlocks },
    { id, kind: 'unlock', domain, unlockMinutes: UNLOCK_MINUTES },
    now,
  )
}

/**
 * The reply to `getEvents`. The cursor is the newest `at` among the returned events, or `since`
 * when there are none (never the wall clock, which could jump past events not yet returned).
 */
export function eventsSince(
  events: readonly BlockEvent[],
  since: number,
): { events: BlockEvent[]; cursor: number } {
  const fresh = events.filter((e) => e.at > since)
  const cursor = fresh.reduce((max, e) => Math.max(max, e.at), since)
  return { events: fresh, cursor }
}

/** Wins for today's local day (0 once the stored day is not today). */
export function winsToday(state: ExtensionState, now: number): number {
  return state.dailyAttempts.date === localDayKey(now) ? state.dailyAttempts.count : 0
}
