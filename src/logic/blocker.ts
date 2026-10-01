/**
 * Blocker rules (BRIEF §5.8), pure. What a person types becomes a domain or an allowlist prefix the same
 * way the extension reads it (`@ext/domains`), with two differences that suit a person instead of a
 * machine: a leading `www.` is dropped (`www.reddit.com` means the site, and a domain entry already
 * covers every subdomain), and a domain that would block Forge itself is refused.
 *
 * Also here: the config the app pushes to the extension (`buildBlockerConfig`), the focus-session state
 * it pushes (`toSessionState`), and the small helpers the editors need (windows, motivation lines,
 * extension id). Nothing here reads a clock or the database.
 */
import type { BlockWindow, BlocklistEntry, Session, Settings } from '@/db/types'
import { APP_ORIGIN, FALLBACK_ORIGIN } from '@ext/config'
import {
  hostMatchesDomain,
  normalizeAllowEntry,
  normalizeBlocklist,
  normalizeDomain,
} from '@ext/domains'
import { LIMITS, isScheduleWindow, type BlockerConfig, type SessionState } from '@ext/protocol'
import { clockOf, plannedEndAt } from './timer'

// ─── Domains ────────────────────────────────────────────────────────────────

/**
 * The addresses Forge itself lives at (GitHub Pages and the Netlify fallback): blocking one of them, or a
 * parent of one, would lock the app out.
 */
const APP_HOSTS: readonly string[] = [APP_ORIGIN, FALLBACK_ORIGIN].map(
  (origin) => new URL(origin).hostname,
)

/** Hosts the app is served from during development. They can never be blocked either. */
const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1']

const stripWww = (host: string): string => {
  const bare = host.replace(/^www\./, '')
  return bare.includes('.') ? bare : host
}

/**
 * `https://www.Instagram.com/explore?x=1` → `instagram.com`. Null when it is not a usable domain
 * (a bare word, an address with spaces, a wildcard).
 */
export function normalizeBlockDomain(raw: string): string | null {
  const domain = normalizeDomain(raw)
  return domain === null ? null : stripWww(domain)
}

export type DomainProblem = 'empty' | 'invalid' | 'duplicate' | 'covered' | 'self' | 'limit'

export type Checked<T> =
  { ok: true; value: T } | { ok: false; problem: DomainProblem; message: string }

const fail = (
  problem: DomainProblem,
  message: string,
): { ok: false; problem: DomainProblem; message: string } => ({
  ok: false,
  problem,
  message,
})

/** The part of a blocklist row the checks need. */
export interface DomainRow {
  domain: string
  enabled: boolean
}

/**
 * Validates a domain typed into the blocklist. `existing` is every block row, so a repeat is caught
 * even when it is switched off, while a parent only "covers" a new entry when it is switched on
 * (blocking just `m.youtube.com` next to a disabled `youtube.com` is a real choice).
 */
export function checkBlockDomain(raw: string, existing: readonly DomainRow[]): Checked<string> {
  if (raw.trim() === '') return fail('empty', 'Type a site, like reddit.com.')
  const domain = normalizeBlockDomain(raw)
  if (domain === null)
    return fail('invalid', 'That doesn’t look like a website. Try something like reddit.com.')
  if (LOCAL_HOSTS.includes(domain) || APP_HOSTS.some((host) => hostMatchesDomain(host, domain))) {
    return fail('self', 'That would block Forge itself, so it can’t be added.')
  }
  if (existing.some((row) => row.domain === domain)) {
    return fail('duplicate', `${domain} is already on the list.`)
  }
  const parent = existing.find((row) => row.enabled && hostMatchesDomain(domain, row.domain))
  if (parent) return fail('covered', `${parent.domain} already blocks ${domain}.`)
  if (existing.length >= LIMITS.blocklist) {
    return fail('limit', `The list is full (${LIMITS.blocklist} sites).`)
  }
  return { ok: true, value: domain }
}

// ─── Allowlist ──────────────────────────────────────────────────────────────

export interface AllowParts {
  /** The site the exception belongs to, e.g. `youtube.com`. */
  domain: string
  /** The prefix that is let through: `youtube.com/watch?v=abc` or `youtube.com/@SomeChannel`. */
  pattern: string
}

/** `https://www.youtube.com/watch?v=abc#t=30` → `youtube.com/watch?v=abc`. Null when unusable. */
export function normalizeAllowPattern(raw: string): AllowParts | null {
  const entry = normalizeAllowEntry(raw)
  if (entry === null) return null
  const cut = entry.search(/[/?]/)
  const host = cut === -1 ? entry : entry.slice(0, cut)
  const rest = cut === -1 ? '' : entry.slice(cut)
  const domain = stripWww(host)
  return { domain, pattern: `${domain}${rest}` }
}

export function checkAllowPattern(
  raw: string,
  existing: readonly { pattern: string | null }[],
): Checked<AllowParts> {
  if (raw.trim() === '')
    return fail('empty', 'Paste a page or channel address, like youtube.com/@CS50.')
  if (/[\s*^|]/.test(raw.trim())) {
    return fail('invalid', 'Use a plain address without spaces or wildcards.')
  }
  const parts = normalizeAllowPattern(raw)
  if (parts === null) {
    return fail(
      'invalid',
      'That doesn’t look like an address. Try youtube.com/watch?v=… or youtube.com/@Channel.',
    )
  }
  if (existing.some((row) => row.pattern === parts.pattern)) {
    return fail('duplicate', `${parts.pattern} is already an exception.`)
  }
  if (existing.length >= LIMITS.allowlist) {
    return fail('limit', `The list is full (${LIMITS.allowlist} exceptions).`)
  }
  return { ok: true, value: parts }
}

/** Splits an allowlist pattern into the part before the path and the path itself, for display. */
export function splitPattern(pattern: string): { host: string; path: string } {
  const cut = pattern.search(/[/?]/)
  return cut === -1
    ? { host: pattern, path: '' }
    : { host: pattern.slice(0, cut), path: pattern.slice(cut) }
}

// ─── Schedule ───────────────────────────────────────────────────────────────

/** Monday first, the order people read a week in. Values are 0 = Sunday … 6 = Saturday. */
export const DAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0]
export const DAY_SHORT: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const DAY_LONG: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/** The window "Add window" starts from: a work day. */
export const DEFAULT_BLOCK_WINDOW: BlockWindow = {
  days: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '17:00',
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Why a schedule window would block nothing (or can't be saved), or null when it is fine. */
export function windowProblem(w: BlockWindow): string | null {
  if (w.days.length === 0) return 'Pick at least one day.'
  if (!TIME.test(w.start) || !TIME.test(w.end)) return 'Pick a start and an end time.'
  if (w.start === w.end) return 'Start and end are the same, so this window is empty.'
  return null
}

/** Days sorted Monday first, without repeats or values outside 0 to 6. */
export function cleanDays(days: readonly number[]): number[] {
  return DAY_ORDER.filter((d) => days.includes(d))
}

/** Adds or removes `day`, keeping Monday-first order. */
export function toggleDay(days: readonly number[], day: number): number[] {
  return cleanDays(days.includes(day) ? days.filter((d) => d !== day) : [...days, day])
}

/**
 * The windows worth storing: valid ones, days in order. A window that runs past midnight
 * (22:00 to 06:00) is fine; an empty one (start = end) is dropped.
 */
export function cleanSchedule(windows: readonly BlockWindow[]): BlockWindow[] {
  return windows
    .map((w) => ({ days: cleanDays(w.days), start: w.start, end: w.end }))
    .filter((w) => windowProblem(w) === null)
    .slice(0, LIMITS.schedule)
}

/** "Mon–Fri", "Mon, Wed, Fri", "Every day". */
export function describeDays(days: readonly number[]): string {
  const sorted = cleanDays(days)
  if (sorted.length === 0) return 'No days'
  if (sorted.length === 7) return 'Every day'
  const runs: number[][] = []
  for (const day of sorted) {
    const run = runs[runs.length - 1]
    const last = run?.[run.length - 1]
    if (run && last !== undefined && DAY_ORDER.indexOf(day) === DAY_ORDER.indexOf(last) + 1)
      run.push(day)
    else runs.push([day])
  }
  return runs
    .map((run) => {
      const first = DAY_SHORT[run[0] ?? 0] ?? ''
      const end = DAY_SHORT[run[run.length - 1] ?? 0] ?? ''
      if (run.length >= 3) return `${first}–${end}`
      return run.map((d) => DAY_SHORT[d] ?? '').join(', ')
    })
    .join(', ')
}

// ─── Motivation lines ───────────────────────────────────────────────────────

/** One line, whitespace collapsed and cut to what the extension accepts. */
export function cleanMotivationLine(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, LIMITS.textLength)
}

/** Trimmed, non-empty, without repeats (case-insensitive), at most the extension's limit. */
export function cleanMotivationLines(lines: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of lines) {
    const line = cleanMotivationLine(raw)
    const key = line.toLowerCase()
    if (line === '' || seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }
  return out.slice(0, LIMITS.motivation)
}

// ─── Extension id ───────────────────────────────────────────────────────────

/** Chrome extension ids are 32 letters a to p. */
export function isValidExtensionId(id: string): boolean {
  return /^[a-p]{32}$/.test(id)
}

/**
 * The override field's text as a stored value: empty resets to the default (`null`), a valid id is kept
 * lower-cased, anything else is rejected with a message.
 */
export function parseExtensionId(
  raw: string,
): { ok: true; id: string | null } | { ok: false; message: string } {
  const text = raw.trim().toLowerCase()
  if (text === '') return { ok: true, id: null }
  if (!isValidExtensionId(text)) {
    return {
      ok: false,
      message: 'An extension ID is 32 letters, a to p. Copy it from chrome://extensions.',
    }
  }
  return { ok: true, id: text }
}

// ─── What the extension is told ─────────────────────────────────────────────

type BlockerSettings = Pick<Settings['blocker'], 'mode' | 'schedule' | 'motivation'>

/**
 * The full config for the extension: switched-on rows only, domains normalised the way the extension
 * reads them, allowlist prefixes, mode, schedule windows and motivation lines. "Off" (a mode the
 * extension does not have) is a focus-only blocker with nothing on its list.
 */
export function buildBlockerConfig(
  entries: readonly BlocklistEntry[],
  blocker: BlockerSettings,
): BlockerConfig {
  const off = blocker.mode === 'off'
  const enabled = entries.filter((e) => e.enabled)
  const domains = enabled
    .filter((e) => e.kind === 'block')
    .flatMap((e) => {
      const domain = normalizeBlockDomain(e.domain)
      return domain === null ? [] : [domain]
    })
  const allow = enabled
    .filter((e) => e.kind === 'allow' && e.pattern !== null)
    .flatMap((e) => {
      const parts = normalizeAllowPattern(e.pattern ?? '')
      return parts === null ? [] : [parts.pattern]
    })
  return {
    mode: blocker.mode === 'off' ? 'focus' : blocker.mode,
    blocklist: off ? [] : normalizeBlocklist(domains).slice(0, LIMITS.blocklist),
    allowlist: off ? [] : [...new Set(allow)].slice(0, LIMITS.allowlist),
    schedule: cleanSchedule(blocker.schedule).filter(isScheduleWindow),
    motivation: cleanMotivationLines(blocker.motivation),
  }
}

/**
 * What the extension is told about the focus timer. Only a focus session counts (a break is time to
 * rest, so nothing is blocked); a paused focus session still counts, with no end in sight, so pausing
 * is not a way around the blocker. `null` = nothing to block for.
 */
export function toSessionState(
  session: Pick<
    Session,
    'kind' | 'status' | 'startedAt' | 'plannedMinutes' | 'pausedMs' | 'pausedAt'
  > | null,
  taskTitle: string | null,
): SessionState | null {
  if (session === null || session.kind !== 'focus') return null
  if (session.status !== 'running' && session.status !== 'paused') return null
  const title =
    taskTitle === null ? '' : taskTitle.replace(/\s+/g, ' ').trim().slice(0, LIMITS.textLength)
  return {
    active: true,
    endsAt: plannedEndAt(clockOf(session)),
    taskTitle: title === '' ? null : title,
  }
}
