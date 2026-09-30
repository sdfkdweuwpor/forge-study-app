/**
 * What Settings → Sync says about the state of syncing (PLAN §4.7.7), as plain data. Pure: the clock, the
 * outbox count and the engine's state come in as arguments, and every sentence is decided here, so the
 * copy is one calm vocabulary and testable line by line. No red unless something needs the person, no
 * counts of what is missing, nothing that nags.
 *
 * The line is split in two. `lead` is what a screen reader's live region announces and changes only when
 * the state changes ("Synced", "3 changes waiting"); `tail` is the part that ticks with the clock
 * (" · 12 minutes ago", " in 5 minutes.") and stays out of the live region, so the line is not
 * re-announced every minute. `lead + tail` is the sentence a sighted reader sees.
 */
import type { Millis, SyncError } from '@/db/types'

/** Which face the Settings section shows (PLAN §4.7.7). */
export type SectionState =
  /** Off, and no project saved: the introduction and "Set up sync". */
  | 'notSetUp'
  /** Off, project saved: the email step. */
  | 'configured'
  /** Off, a sign-in link or code was requested: waiting for the email. */
  | 'waiting'
  /** On, bringing this device together with the cloud copy for the first time, and nothing has gone wrong. */
  | 'firstSync'
  /** On (also a first sync that failed: the status line says why, and its controls are the way out). */
  | 'on'

export interface SectionInput {
  enabled: boolean
  phase: 'off' | 'bootstrap' | 'steady'
  url: string | null
  anonKey: string | null
  pendingLogin: unknown
  signedIn: boolean
  lastError: SyncError | null
}

/**
 * Which face the section shows. The first sync stays a first sync (`phase: 'bootstrap'`) until one cycle
 * gets all the way through, so a failed first cycle (the setup SQL not run yet, no network, a paused
 * project) still has that phase: it is shown as `on`, where the error and what to do about it are.
 */
export function sectionState(v: SectionInput): SectionState {
  if (v.enabled) {
    return v.phase !== 'steady' && v.signedIn && v.lastError === null ? 'firstSync' : 'on'
  }
  if (v.pendingLogin !== null) return 'waiting'
  return v.url !== null && v.anonKey !== null ? 'configured' : 'notSetUp'
}

export interface SyncStatusInput {
  now: Millis
  /** `navigator.onLine`. */
  online: boolean
  /** A cycle is running, in this tab or in the tab that syncs. */
  running: boolean
  /** Changes waiting in the outbox. */
  pending: number
  /** A session exists. */
  signedIn: boolean
  lastSyncAt: Millis | null
  lastError: SyncError | null
  /** When the engine will try again, when this tab knows. */
  retryAt: Millis | null
  /** Repeated 5xx / 540 answers (see the engine). */
  paused: boolean
}

export type StatusTone = 'ok' | 'quiet' | 'attention'

/** What the person can do about it: each one has its own control in the section. */
export type StatusNeed = 'signIn' | 'setup' | 'forbidden' | 'update' | 'paused'

export interface SyncStatusLine {
  lead: string
  tail: string
  tone: StatusTone
  need: StatusNeed | null
}

/**
 * The two sentences the repo engine also stores in `syncState.lastError` (`SYNC_TEXT` in `syncApply.ts`).
 * They are repeated here, and checked equal in the tests, so the Settings section does not have to load
 * the engine's rules (`syncApply` reaches the scheduler and the level rules) just to say them.
 */
export const SIGNED_OUT_TEXT =
  'Sign in again to keep syncing. Your changes are kept on this device.'
export const UPDATE_NEEDED_TEXT =
  'Another device runs a newer Forge. Reload to update this one; sync picks up where it left off.'

/** The sentence for a project that keeps answering with a server error. */
export const PAUSED_TEXT =
  'Your Supabase project may be paused. Free projects pause after a week without use; restore it from the Supabase dashboard.'

export const SETUP_TEXT = "The forge_rows table isn't there yet. Run the setup SQL in your project."
export const FORBIDDEN_TEXT = "The table's access rules are missing. Run the setup SQL again."
export const OFFLINE_TEXT = "Offline. Changes will sync when you're back online."

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** "just now", "1 minute ago", "12 minutes ago", "3 hours ago", "yesterday", "5 days ago". */
export function formatAgo(ms: number): string {
  const d = Math.max(0, ms)
  if (d < MINUTE) return 'just now'
  if (d < HOUR) return `${plural(Math.floor(d / MINUTE), 'minute', 'minutes')} ago`
  if (d < DAY) return `${plural(Math.floor(d / HOUR), 'hour', 'hours')} ago`
  const days = Math.floor(d / DAY)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** "less than a minute", "5 minutes", "1 hour": how long until the next try. Rounds up. */
export function formatWait(ms: number): string {
  if (ms <= MINUTE) return 'less than a minute'
  if (ms < HOUR) return plural(Math.ceil(ms / MINUTE), 'minute', 'minutes')
  return plural(Math.ceil(ms / HOUR), 'hour', 'hours')
}

/** The need an error stops sync for, or null for the errors that just retry. */
function needOf(error: SyncError | null, signedIn: boolean, paused: boolean): StatusNeed | null {
  if (error?.kind === 'signedOut' || !signedIn) return 'signIn'
  if (error?.kind === 'setup') return 'setup'
  if (error?.kind === 'forbidden') return 'forbidden'
  if (error?.kind === 'updateNeeded') return 'update'
  if (paused) return 'paused'
  return null
}

const NEED_TEXT: Readonly<Record<StatusNeed, string>> = {
  signIn: SIGNED_OUT_TEXT,
  setup: SETUP_TEXT,
  forbidden: FORBIDDEN_TEXT,
  update: UPDATE_NEEDED_TEXT,
  paused: PAUSED_TEXT,
}

/**
 * The line for an enabled device, most pressing first: something the person must do, then offline, then
 * a cycle in progress, then a retry, then changes waiting, then the last sync.
 */
export function describeSync(input: SyncStatusInput): SyncStatusLine {
  const { now, online, running, pending, lastSyncAt, lastError, retryAt } = input
  const need = needOf(lastError, input.signedIn, input.paused)
  if (need !== null) return { lead: NEED_TEXT[need], tail: '', tone: 'attention', need }
  const quiet = (lead: string, tail = ''): SyncStatusLine => ({
    lead,
    tail,
    tone: 'quiet',
    need: null,
  })
  if (!online || lastError?.kind === 'offline') return quiet(OFFLINE_TEXT)
  if (running) return quiet('Syncing…')
  // A note from a cycle that worked: a record the server would not take stays on this device.
  if (lastError !== null && lastSyncAt !== null && lastError.at <= lastSyncAt) {
    return quiet(lastError.message)
  }
  if (lastError?.kind === 'snapshot') return quiet(lastError.message)
  if (
    lastError?.kind === 'server' ||
    lastError?.kind === 'rateLimited' ||
    lastError?.kind === 'tooLarge'
  ) {
    return retryAt === null
      ? quiet('Trying again shortly.')
      : quiet('Trying again', ` in ${formatWait(retryAt - now)}.`)
  }
  if (pending > 0) return quiet(`${plural(pending, 'change', 'changes')} waiting`)
  if (lastSyncAt !== null) {
    return { lead: 'Synced', tail: ` · ${formatAgo(now - lastSyncAt)}`, tone: 'ok', need: null }
  }
  return quiet('Waiting for the first sync.')
}

/** Skew beyond which Settings says so (PLAN §4.7.5). */
export const CLOCK_WARNING_MS = 2 * MINUTE

/**
 * The warning for a device whose clock is off, or null. `skewMs` is server minus device, so a positive
 * value means this device is behind.
 */
export function clockWarning(skewMs: number | null): string | null {
  if (skewMs === null || !Number.isFinite(skewMs) || Math.abs(skewMs) <= CLOCK_WARNING_MS) {
    return null
  }
  const minutes = Math.round(Math.abs(skewMs) / MINUTE)
  const off = `${plural(minutes, 'minute', 'minutes')} ${skewMs > 0 ? 'behind' : 'ahead'}`
  return `This device's clock is ${off}. Sync keeps the newest change by time, so set the clock to update automatically.`
}

/** What the first sync is doing, for the quiet count under "Bringing this device together…". */
export function progressText(progress: { step: string; rows: number } | null): string {
  if (progress === null) return 'Getting started…'
  const items = `${progress.rows.toLocaleString('en-US')} ${progress.rows === 1 ? 'item' : 'items'}`
  switch (progress.step) {
    case 'snapshot':
      return 'Saving a snapshot first…'
    case 'pull':
    case 'merge':
      return progress.rows > 0 ? `${items} so far` : 'Reading your cloud copy…'
    case 'push':
      return `Sent ${items}`
    default:
      return 'Working…'
  }
}
