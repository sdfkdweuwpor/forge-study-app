/**
 * XP amounts, session anti-cheat, levels and balances (BRIEF §5.5, PLAN §3.6). Pure: XP is derived
 * from the append-only `xpEvents` log and the `redemptions` table, never stored as a counter.
 */
import type { Priority, Redemption, XpEvent } from '@/db/types'

// ─── Amounts ────────────────────────────────────────────────────────────────

export const XP_TASK_BASE = 10
export const XP_TASK_PER_POMODORO = 5
export const XP_PRIORITY_HIGH = 5
export const XP_PRIORITY_URGENT = 10
export const XP_PER_FOCUS_MINUTE = 1
export const XP_COURSE_COMPLETE = 250
export const XP_DAILY_GOAL = 25
export const XP_RITUAL = 10

/** Consecutive-day milestones and what reaching each one pays (once per streak run). */
export const STREAK_MILESTONES = [7, 30, 100] as const
export type StreakMilestone = (typeof STREAK_MILESTONES)[number]
export const XP_STREAK_MILESTONE: Readonly<Record<StreakMilestone, number>> = {
  7: 100,
  30: 500,
  100: 2000,
}

/** XP for a streak of exactly `days`; 0 when that length is not a milestone. */
export function xpForStreakMilestone(days: number): number {
  const milestone = STREAK_MILESTONES.find((m) => m === days)
  return milestone === undefined ? 0 : XP_STREAK_MILESTONE[milestone]
}

/** Task done: `10 + 5 × estimatedPomodoros`, plus 5 for high and 10 for urgent priority. */
export function xpForTask(input: { estimate?: number | null; priority?: Priority | null }): number {
  const raw = input.estimate ?? 0
  const pomodoros = Number.isFinite(raw) ? Math.max(0, raw) : 0
  const bonus =
    input.priority === 4 ? XP_PRIORITY_URGENT : input.priority === 3 ? XP_PRIORITY_HIGH : 0
  return Math.round(XP_TASK_BASE + XP_TASK_PER_POMODORO * pomodoros + bonus)
}

// ─── Focus sessions (anti-cheat) ────────────────────────────────────────────

/** A planned session counts once it reaches this share of the plan. */
export const SESSION_COUNT_RATIO = 0.8
/** A stopwatch session has no plan, so it counts from this many minutes (DECISIONS: anti-cheat). */
export const STOPWATCH_MIN_MINUTES = 10

export interface SessionXpInput {
  /** `null`/`undefined` = stopwatch (no plan). */
  plannedMin?: number | null
  actualMin: number
}

/**
 * Whether a finished focus session counts: `actual ≥ 80% of planned`, or `≥ 10 min` for a stopwatch.
 * Compared as `actual × 5 ≥ planned × 4` so 80% of 25 min is exactly 20, with no float noise.
 */
export function isSessionCounted(input: SessionXpInput): boolean {
  const actual = Number.isFinite(input.actualMin) ? input.actualMin : 0
  if (actual <= 0) return false
  const planned = input.plannedMin
  if (planned === null || planned === undefined || !(planned > 0)) {
    return actual >= STOPWATCH_MIN_MINUTES
  }
  return actual * 5 >= planned * 4
}

/** 1 XP per focused (whole) minute, only when the session counts; otherwise 0. */
export function xpForSession(input: SessionXpInput): number {
  if (!isSessionCounted(input)) return 0
  return Math.floor(input.actualMin) * XP_PER_FOCUS_MINUTE
}

// ─── Levels ─────────────────────────────────────────────────────────────────

/**
 * XP needed to advance from level `n` to level `n + 1`: `round(100 · n^1.5)`. This is a per-level
 * cost (L1→2 is 100, L7→8 is 1,852), matching the brief's "Level 7 … /1,800" sidebar mock. Levels
 * are cumulative: reaching level `n` takes `xpToReachLevel(n)` lifetime XP.
 */
export function xpForLevel(n: number): number {
  const level = Math.max(1, Math.floor(n))
  return Math.round(100 * Math.pow(level, 1.5))
}

/** Lifetime XP at which level `n` begins: the sum of every earlier level's cost (level 1 = 0). */
export function xpToReachLevel(n: number): number {
  const target = Math.max(1, Math.floor(n))
  let total = 0
  for (let level = 1; level < target; level++) total += xpForLevel(level)
  return total
}

export interface LevelInfo {
  /** Current level, starting at 1. */
  level: number
  /** Lifetime XP earned inside the current level. */
  intoLevel: number
  /** Cost of advancing from the current level to the next. */
  needed: number
  /** `intoLevel / needed`, 0 ≤ progress < 1. */
  progress: number
}

/** Level, in-level XP and progress for a lifetime XP total. Negative/NaN counts as 0. */
export function levelFromLifetimeXp(total: number): LevelInfo {
  let remaining = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
  let level = 1
  let needed = xpForLevel(level)
  while (remaining >= needed) {
    remaining -= needed
    level += 1
    needed = xpForLevel(level)
  }
  return { level, intoLevel: remaining, needed, progress: remaining / needed }
}

// ─── Balance ────────────────────────────────────────────────────────────────

/** `lifetimeXp = Σ amount` over the whole log (reversals are negative events, so they net out). */
export function lifetimeXp(events: readonly Pick<XpEvent, 'amount'>[]): number {
  let total = 0
  for (const event of events) total += event.amount
  return total
}

/** `spentXp = Σ price` of redemptions that have not been refunded. */
export function spentXp(redemptions: readonly Pick<Redemption, 'price' | 'refundedAt'>[]): number {
  let total = 0
  for (const redemption of redemptions) {
    if (redemption.refundedAt === null) total += redemption.price
  }
  return total
}

/**
 * Spendable XP: `lifetime − spent`. Redemptions live in their own table (they are not XP events),
 * so pass them as the second argument; omitted, nothing has been spent. Levels use lifetime XP only.
 */
export function balance(
  events: readonly Pick<XpEvent, 'amount'>[],
  redemptions: readonly Pick<Redemption, 'price' | 'refundedAt'>[] = [],
): number {
  return lifetimeXp(events) - spentXp(redemptions)
}
