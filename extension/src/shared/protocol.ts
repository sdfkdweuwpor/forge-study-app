/**
 * App <-> extension message contract (PLAN §1.4). Dependency-free: the web app imports this file
 * through the `@ext/*` alias and the service worker validates every incoming message with the same
 * guards. The guards check shape deeply, never throw, and reject anything that could corrupt the
 * extension's storage (wrong types, out-of-range days or times, oversized lists).
 */

export const PROTOCOL_VERSION = 1

/** Upper bounds the guards enforce. The app should stay below them (the Blocker editor can cap at these). */
export const LIMITS = {
  blocklist: 500,
  allowlist: 500,
  schedule: 50,
  motivation: 200,
  /** A domain or allowlist prefix. */
  entryLength: 2048,
  /** A motivation line or a task title. */
  textLength: 500,
} as const

export const BLOCKER_MODES = ['focus', 'schedule', 'always'] as const
export type BlockerMode = (typeof BLOCKER_MODES)[number]

export const BLOCK_EVENT_KINDS = ['blocked', 'unlock'] as const
export type BlockEventKind = (typeof BLOCK_EVENT_KINDS)[number]

export interface ScheduleWindow {
  /** 0 = Sunday … 6 = Saturday. A window that ends before it starts runs overnight into the next day. */
  days: number[]
  /** 'HH:mm', 24-hour, local time. */
  start: string
  /** 'HH:mm', 24-hour, local time. Equal to `start` means an empty window. */
  end: string
}

export interface BlockerConfig {
  mode: BlockerMode
  /** Domains; each also blocks its subdomains. */
  blocklist: string[]
  /** URL prefixes without a scheme, e.g. `youtube.com/watch?v=abc` or `youtube.com/@SomeChannel`. */
  allowlist: string[]
  schedule: ScheduleWindow[]
  motivation: string[]
}

export interface SessionState {
  active: boolean
  /** Epoch ms when the session ends, or null when open-ended. */
  endsAt: number | null
  taskTitle: string | null
}

export interface BlockEvent {
  /** Stable and unique, so the app can `bulkPut` the same event twice. */
  id: string
  /** Epoch ms. Strictly increasing in the order the extension recorded events. */
  at: number
  kind: BlockEventKind
  domain: string
  unlockMinutes?: number
}

export type AppMessage =
  | { v: 1; type: 'ping' }
  | { v: 1; type: 'sync'; config: BlockerConfig }
  | { v: 1; type: 'session'; session: SessionState | null }
  | { v: 1; type: 'getEvents'; since: number }

export type AppResponse =
  | { ok: true; version?: string; events?: BlockEvent[]; cursor?: number }
  | { ok: false; error: string }

/** `HH:mm`, 00:00 to 23:59. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

function isStringList(x: unknown, maxItems: number, maxLength: number): x is string[] {
  return (
    Array.isArray(x) &&
    x.length <= maxItems &&
    x.every((item) => typeof item === 'string' && item.length <= maxLength)
  )
}

export function isTimeOfDay(x: unknown): x is string {
  return typeof x === 'string' && TIME_OF_DAY.test(x)
}

export function isBlockerMode(x: unknown): x is BlockerMode {
  return typeof x === 'string' && (BLOCKER_MODES as readonly string[]).includes(x)
}

export function isScheduleWindow(x: unknown): x is ScheduleWindow {
  if (!isRecord(x)) return false
  const { days, start, end } = x
  return (
    Array.isArray(days) &&
    days.length <= 7 &&
    days.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6) &&
    isTimeOfDay(start) &&
    isTimeOfDay(end)
  )
}

export function isBlockerConfig(x: unknown): x is BlockerConfig {
  if (!isRecord(x)) return false
  return (
    isBlockerMode(x['mode']) &&
    isStringList(x['blocklist'], LIMITS.blocklist, LIMITS.entryLength) &&
    isStringList(x['allowlist'], LIMITS.allowlist, LIMITS.entryLength) &&
    Array.isArray(x['schedule']) &&
    x['schedule'].length <= LIMITS.schedule &&
    x['schedule'].every(isScheduleWindow) &&
    isStringList(x['motivation'], LIMITS.motivation, LIMITS.textLength)
  )
}

export function isSessionState(x: unknown): x is SessionState {
  if (!isRecord(x)) return false
  const { active, endsAt, taskTitle } = x
  return (
    typeof active === 'boolean' &&
    (endsAt === null || isFiniteNumber(endsAt)) &&
    (taskTitle === null || (typeof taskTitle === 'string' && taskTitle.length <= LIMITS.textLength))
  )
}

export function isBlockEvent(x: unknown): x is BlockEvent {
  if (!isRecord(x)) return false
  const { id, at, kind, domain, unlockMinutes } = x
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    isFiniteNumber(at) &&
    typeof kind === 'string' &&
    (BLOCK_EVENT_KINDS as readonly string[]).includes(kind) &&
    typeof domain === 'string' &&
    (unlockMinutes === undefined || isFiniteNumber(unlockMinutes))
  )
}

export function isAppMessage(x: unknown): x is AppMessage {
  if (!isRecord(x) || x['v'] !== PROTOCOL_VERSION) return false
  switch (x['type']) {
    case 'ping':
      return true
    case 'sync':
      return isBlockerConfig(x['config'])
    case 'session':
      return x['session'] === null || isSessionState(x['session'])
    case 'getEvents':
      return isFiniteNumber(x['since']) && x['since'] >= 0
    default:
      return false
  }
}
