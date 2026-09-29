/**
 * Focus timer math (BRIEF §5.2, PLAN §1.3). Pure: every function takes `now` as an argument, and every
 * duration is computed from stored timestamps, never from a counter that could drift or die with the
 * tab. A running or paused session is one `sessions` row (`startedAt`, `pausedMs`, `pausedAt`); this
 * file turns that row into remaining time, display text, the pomodoro cycle and the session outcome.
 *
 * All instants are epoch milliseconds, so daylight-saving changes cannot bend a session: a 25-minute
 * pomodoro that runs through the 2026-11-01 clock change is still exactly 25 minutes long.
 */
import { format } from 'date-fns'
import type { Millis, Session, SessionKind, SessionMode, SessionStatus } from '@/db/types'
import { isSessionCounted, STOPWATCH_MIN_MINUTES, xpForSession } from './xp'

export const MS_PER_SECOND = 1_000
export const MS_PER_MINUTE = 60_000

// ─── The clock ──────────────────────────────────────────────────────────────

/** The part of a session row the timer needs. `plannedMs` is `null` for a stopwatch. */
export interface TimerClock {
  startedAt: Millis
  plannedMs: number | null
  /** Total length of the pauses that have already ended. */
  pausedMs: number
  /** When the pause in progress began, or `null` while running. */
  pausedAt: Millis | null
}

type ClockFields = Pick<Session, 'startedAt' | 'plannedMinutes' | 'pausedMs' | 'pausedAt'>

/** The clock of a stored session row. */
export function clockOf(row: ClockFields): TimerClock {
  return {
    startedAt: row.startedAt,
    plannedMs: row.plannedMinutes === null ? null : row.plannedMinutes * MS_PER_MINUTE,
    pausedMs: row.pausedMs,
    pausedAt: row.pausedAt,
  }
}

/**
 * Time that actually counted: `now − startedAt − pausedMs`, with the clock frozen at `pausedAt` while
 * paused. A refresh while paused therefore changes nothing. Never negative, even if the system clock
 * moved backwards.
 */
export function elapsedMs(clock: TimerClock, now: Millis): number {
  const stop = clock.pausedAt ?? now
  return Math.max(0, stop - clock.startedAt - clock.pausedMs)
}

/** Time left, never negative; `null` for a stopwatch (no plan). */
export function remainingMs(clock: TimerClock, now: Millis): number | null {
  return clock.plannedMs === null ? null : Math.max(0, clock.plannedMs - elapsedMs(clock, now))
}

/** The instant a running session reaches its plan; `null` while paused (no end in sight) or for a stopwatch. */
export function plannedEndAt(clock: TimerClock): Millis | null {
  if (clock.plannedMs === null || clock.pausedAt !== null) return null
  return clock.startedAt + clock.plannedMs + clock.pausedMs
}

/** A running, planned session whose time is up. A paused session is never due. */
export function isDue(clock: TimerClock, now: Millis): boolean {
  const end = plannedEndAt(clock)
  return end !== null && now >= end
}

/** Starts a pause. Pausing a paused clock changes nothing. */
export function pauseClock(clock: TimerClock, now: Millis): TimerClock {
  if (clock.pausedAt !== null) return clock
  return { ...clock, pausedAt: Math.max(now, clock.startedAt) }
}

/** Ends the pause in progress and adds it to `pausedMs`. Resuming a running clock changes nothing. */
export function resumeClock(clock: TimerClock, now: Millis): TimerClock {
  if (clock.pausedAt === null) return clock
  return { ...clock, pausedMs: clock.pausedMs + Math.max(0, now - clock.pausedAt), pausedAt: null }
}

// ─── What the screen shows ──────────────────────────────────────────────────

/**
 * The whole seconds to draw: a countdown rounds up (so it reads 00:00 only when time is really up),
 * a stopwatch rounds down.
 */
export function displaySeconds(clock: TimerClock, now: Millis): number {
  const remaining = remainingMs(clock, now)
  return remaining === null
    ? Math.floor(elapsedMs(clock, now) / MS_PER_SECOND)
    : Math.ceil(remaining / MS_PER_SECOND)
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `mm:ss`, or `h:mm:ss` from one hour. Negative and non-finite values read 00:00. */
export function formatClock(totalSeconds: number): string {
  const total = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`
}

/** How far along the ring is, 0 to 1. A stopwatch fills toward the minute it starts to count (10). */
export function progress(clock: TimerClock, now: Millis): number {
  const elapsed = elapsedMs(clock, now)
  const total = clock.plannedMs ?? STOPWATCH_MIN_MINUTES * MS_PER_MINUTE
  return total > 0 ? Math.min(1, elapsed / total) : 0
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** "24 minutes 59 seconds", for a screen reader; whole minutes and hours drop the zero parts. */
export function spokenClock(totalSeconds: number): string {
  const total = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const parts: string[] = []
  if (hours > 0) parts.push(plural(hours, 'hour'))
  if (minutes > 0) parts.push(plural(minutes, 'minute'))
  if (seconds > 0 || parts.length === 0) parts.push(plural(seconds, 'second'))
  return parts.join(' ')
}

/** "25 min", "1 h", "1 h 5 min". Non-finite and negative values read "0 min". */
export function formatMinutes(minutes: number): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** "9:30 AM" in the device's time zone. */
export function formatClockTime(at: Millis): string {
  return format(at, 'h:mm a')
}

/** "9:30–9:55 AM"; the meridiem is written once when both ends share it, and an open end is "now". */
export function formatSpan(start: Millis, end: Millis | null): string {
  const from = formatClockTime(start)
  if (end === null) return `${from} – now`
  const to = formatClockTime(end)
  const [fromTime, fromMeridiem] = from.split(' ')
  const [, toMeridiem] = to.split(' ')
  return fromMeridiem === toMeridiem ? `${fromTime}–${to}` : `${from}–${to}`
}

// ─── Announcements (aria-live) ──────────────────────────────────────────────

/** Minutes left at which a screen reader is told; the timer is never read out every second. */
export const ANNOUNCE_MARKS_MIN = [30, 15, 10, 5, 1] as const

/**
 * The announcement mark a countdown has just passed, in minutes, or `null`. A mark counts when the
 * display goes from above `mark:00` to `mark:00` or below, and only when the plan is longer than the
 * mark (a 5-minute break is not announced "5 minutes left" the moment it starts). When one jump passes
 * several marks (a tab asleep for a while), the nearest one wins.
 */
export function crossedMark(
  previousSeconds: number,
  currentSeconds: number,
  plannedMs: number,
): number | null {
  let hit: number | null = null
  for (const mark of ANNOUNCE_MARKS_MIN) {
    if (mark * MS_PER_MINUTE >= plannedMs) continue
    if (previousSeconds > mark * 60 && currentSeconds <= mark * 60) hit = mark
  }
  return hit
}

// ─── Pomodoro cycle ─────────────────────────────────────────────────────────

export interface CycleConfig {
  pomodoroMin: number
  shortBreakMin: number
  longBreakMin: number
  /** A long break follows every this-many focus rounds. */
  longBreakEvery: number
}

export type PhaseVariant = 'focus' | 'short-break' | 'long-break'

export interface Phase {
  kind: SessionKind
  variant: PhaseVariant
  minutes: number
  /** The focus round this phase is (focus) or follows (break). */
  round: number
}

const clampInt = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

/** Settings values made safe: whole minutes of at least 1, and a long break interval of at least 1. */
export function normalizeCycle(cfg: CycleConfig): CycleConfig {
  return {
    pomodoroMin: clampInt(cfg.pomodoroMin, 1, 240, 25),
    shortBreakMin: clampInt(cfg.shortBreakMin, 1, 120, 5),
    longBreakMin: clampInt(cfg.longBreakMin, 1, 120, 15),
    longBreakEvery: clampInt(cfg.longBreakEvery, 1, 12, 4),
  }
}

/** "Round 2 of 4": where round `round` sits in the cycle. Round 5 is round 1 of the next cycle. */
export function cyclePosition(round: number, every: number): { position: number; total: number } {
  const total = Math.max(1, Math.floor(every))
  const r = Math.max(1, Math.floor(round))
  return { position: ((r - 1) % total) + 1, total }
}

/** The focus phase of round `round`. */
export function focusPhase(round: number, cfg: CycleConfig): Phase {
  const c = normalizeCycle(cfg)
  return { kind: 'focus', variant: 'focus', minutes: c.pomodoroMin, round: Math.max(1, round) }
}

/** The break that follows focus round `round`: long after every `longBreakEvery`-th round, else short. */
export function breakAfter(round: number, cfg: CycleConfig): Phase {
  const c = normalizeCycle(cfg)
  const r = Math.max(1, Math.floor(round))
  const long = r % c.longBreakEvery === 0
  return {
    kind: 'break',
    variant: long ? 'long-break' : 'short-break',
    minutes: long ? c.longBreakMin : c.shortBreakMin,
    round: r,
  }
}

/** Which phase a stored session is: a focus round, or the short or long break after round `round`. */
export function variantOf(
  session: { kind: SessionKind; round: number },
  cfg: Pick<CycleConfig, 'longBreakEvery'>,
): PhaseVariant {
  if (session.kind === 'focus') return 'focus'
  const every = clampInt(cfg.longBreakEvery, 1, 12, 4)
  return session.round % every === 0 ? 'long-break' : 'short-break'
}

const PHASE_LABELS: Record<PhaseVariant, string> = {
  focus: 'Focus',
  'short-break': 'Short break',
  'long-break': 'Long break',
}

export function phaseLabel(variant: PhaseVariant): string {
  return PHASE_LABELS[variant]
}

/** What comes after a phase: a break after focus round `r`, and focus round `r + 1` after a break. */
export function nextPhase(prev: { kind: SessionKind; round: number }, cfg: CycleConfig): Phase {
  return prev.kind === 'focus' ? breakAfter(prev.round, cfg) : focusPhase(prev.round + 1, cfg)
}

/** The last phase of the pomodoro cycle, as much of a session row as `upNext` reads. */
export interface LastPhase {
  kind: SessionKind
  mode: SessionMode
  status: SessionStatus
  round: number
  endedAt: Millis | null
  counted: boolean
}

/** A cycle is stale after this long: a break offered two hours after a round would only confuse. */
export const UP_NEXT_WINDOW_MS = 30 * MS_PER_MINUTE

/**
 * The phase to offer next when nothing is running, or `null` for a fresh start. Only pomodoro
 * sessions chain. After a counted focus round comes its break; after a break (finished or skipped)
 * comes the next round. A round that did not count, or was thrown away, offers nothing: the cycle
 * has not moved.
 */
export function upNext(last: LastPhase | null, now: Millis, cfg: CycleConfig): Phase | null {
  if (!last || last.mode !== 'pomodoro' || last.endedAt === null) return null
  if (last.status !== 'completed' && last.status !== 'abandoned') return null
  if (now - last.endedAt > UP_NEXT_WINDOW_MS) return null
  if (last.kind === 'focus') {
    return last.status === 'completed' && last.counted ? nextPhase(last, cfg) : null
  }
  return nextPhase(last, cfg)
}

// ─── Outcome of a session ───────────────────────────────────────────────────

/** A session shorter than this is a slip of the finger: it is thrown away, not logged. */
export const DISCARD_UNDER_MS = MS_PER_MINUTE

export function shouldDiscard(elapsed: number): boolean {
  return elapsed < DISCARD_UNDER_MS
}

export interface SessionOutcome {
  /** Whole minutes focused (rounded down: XP is per whole minute). */
  actualMinutes: number
  /** Anti-cheat (BRIEF §5.5): at least 80% of the plan, or 10 minutes for a stopwatch. Focus only. */
  counted: boolean
  /** 1 XP per whole minute when counted, otherwise 0. */
  xp: number
}

/** How a finished session settles: its minutes, whether it counts, and the XP it earns. */
export function settleSession(input: {
  kind: SessionKind
  plannedMinutes: number | null
  elapsedMs: number
}): SessionOutcome {
  const elapsed = Number.isFinite(input.elapsedMs) ? Math.max(0, input.elapsedMs) : 0
  const actualMinutes = Math.floor(elapsed / MS_PER_MINUTE)
  if (input.kind === 'break') return { actualMinutes, counted: false, xp: 0 }
  const basis = { plannedMin: input.plannedMinutes, actualMin: actualMinutes }
  return { actualMinutes, counted: isSessionCounted(basis), xp: xpForSession(basis) }
}

/** The XP a settled session earned: its whole minutes when it counted, else nothing. */
export function earnedXp(session: Pick<Session, 'counted' | 'actualMinutes'>): number {
  return session.counted ? Math.max(0, session.actualMinutes ?? 0) : 0
}
