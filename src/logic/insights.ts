/**
 * What the focus check-ins say about when you focus best (pure; BRIEF §5.11). Every function takes
 * plain check-in rows and never guesses: an hour, weekday or slot needs `minSamples` ratings before it
 * is named, so one lucky session never becomes a "best hour".
 *
 * Hours are the hour the session started (0-23); weekdays are 0 = Sunday to 6 = Saturday, as everywhere
 * else in Forge. Rows that are not in those ranges (a hand-edited backup) are ignored.
 */
import type { CheckIn } from '@/db/types'

/** The part of a check-in the insights read. */
export type CheckInSample = Pick<CheckIn, 'hour' | 'weekday' | 'focus'>

/** Ratings an hour, weekday or slot needs before it counts. */
export const MIN_SAMPLES = 3

export interface InsightOptions {
  /** Ratings needed before a bucket is named. Default `MIN_SAMPLES`. */
  minSamples?: number
  /** At most this many results, best first. Default 3. */
  limit?: number
}

export interface HourInsight {
  hour: number
  /** Mean focus rating, 1-5. */
  avg: number
  /** How many ratings it rests on. */
  n: number
}

export interface WeekdayInsight {
  weekday: number
  avg: number
  n: number
}

export interface SlotInsight {
  weekday: number
  hour: number
  avg: number
  n: number
}

const DEFAULT_LIMIT = 3

const isHour = (h: number): boolean => Number.isInteger(h) && h >= 0 && h <= 23
const isWeekday = (d: number): boolean => Number.isInteger(d) && d >= 0 && d <= 6
const isRating = (f: number): boolean => Number.isInteger(f) && f >= 1 && f <= 5

interface Bucket {
  sum: number
  n: number
}

/** Ratings grouped by `keyOf`, skipping rows that are out of range. */
function group(
  rows: readonly CheckInSample[],
  keyOf: (row: CheckInSample) => number | null,
): Map<number, Bucket> {
  const buckets = new Map<number, Bucket>()
  for (const row of rows) {
    if (!isRating(row.focus)) continue
    const key = keyOf(row)
    if (key === null) continue
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.sum += row.focus
      bucket.n += 1
    } else {
      buckets.set(key, { sum: row.focus, n: 1 })
    }
  }
  return buckets
}

/** Best average first; on a tie the one with more ratings, then the smaller key (deterministic). */
function ranked<T extends { avg: number; n: number }>(
  items: T[],
  tiebreak: (a: T, b: T) => number,
  limit: number,
): T[] {
  return items
    .sort((a, b) => b.avg - a.avg || b.n - a.n || tiebreak(a, b))
    .slice(0, Math.max(0, limit))
}

function settle(options: InsightOptions): { minSamples: number; limit: number } {
  const minSamples = Math.max(1, Math.floor(options.minSamples ?? MIN_SAMPLES))
  return { minSamples, limit: options.limit ?? DEFAULT_LIMIT }
}

/** The hours you rate your focus highest, best first (default top 3). */
export function bestFocusHours(
  checkIns: readonly CheckInSample[],
  options: InsightOptions = {},
): HourInsight[] {
  const { minSamples, limit } = settle(options)
  const buckets = group(checkIns, (c) => (isHour(c.hour) ? c.hour : null))
  const hours = [...buckets]
    .filter(([, b]) => b.n >= minSamples)
    .map(([hour, b]): HourInsight => ({ hour, avg: b.sum / b.n, n: b.n }))
  return ranked(hours, (a, b) => a.hour - b.hour, limit)
}

/** The weekdays you rate your focus highest, best first (default top 3). */
export function bestWeekdays(
  checkIns: readonly CheckInSample[],
  options: InsightOptions = {},
): WeekdayInsight[] {
  const { minSamples, limit } = settle(options)
  const buckets = group(checkIns, (c) => (isWeekday(c.weekday) ? c.weekday : null))
  const days = [...buckets]
    .filter(([, b]) => b.n >= minSamples)
    .map(([weekday, b]): WeekdayInsight => ({ weekday, avg: b.sum / b.n, n: b.n }))
  return ranked(days, (a, b) => a.weekday - b.weekday, limit)
}

/**
 * The (weekday, hour) slots where focus runs highest: where a hard task fits best (default top 3). A
 * slot needs `minSamples` ratings of its own, so this stays empty longer than the hour and weekday lists.
 */
export function suggestHardTaskSlots(
  checkIns: readonly CheckInSample[],
  options: InsightOptions = {},
): SlotInsight[] {
  const { minSamples, limit } = settle(options)
  // One key per slot: weekday * 24 + hour.
  const buckets = group(checkIns, (c) =>
    isWeekday(c.weekday) && isHour(c.hour) ? c.weekday * 24 + c.hour : null,
  )
  const slots = [...buckets]
    .filter(([, b]) => b.n >= minSamples)
    .map(([key, b]): SlotInsight => ({
      weekday: Math.floor(key / 24),
      hour: key % 24,
      avg: b.sum / b.n,
      n: b.n,
    }))
  return ranked(slots, (a, b) => a.weekday - b.weekday || a.hour - b.hour, limit)
}

/**
 * The single best hour, or `null` while no hour has enough ratings. This is what the planner is told
 * (`settings.scheduling.bestHour`).
 */
export function topFocusHour(
  checkIns: readonly CheckInSample[],
  minSamples: number = MIN_SAMPLES,
): number | null {
  return bestFocusHours(checkIns, { minSamples, limit: 1 })[0]?.hour ?? null
}

// ─── Words ──────────────────────────────────────────────────────────────────

/** "9 AM" for hour 9, "12 PM" for noon, "12 AM" for midnight. */
export function hourLabel(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

/** "Tuesday", or "Tue" with `'short'`; weekday 0 is Sunday. */
export function weekdayName(weekday: number, style: 'long' | 'short' = 'long'): string {
  const name = WEEKDAYS[((Math.floor(weekday) % 7) + 7) % 7] ?? 'Sunday'
  return style === 'short' ? name.slice(0, 3) : name
}
