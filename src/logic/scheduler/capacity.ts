/**
 * Day arithmetic and daily capacity for the scheduler (pure).
 *
 * The walk goes day by day for up to three years and catch-up re-runs it dozens of times, so days are
 * whole numbers (days since 1970-01-01 on the proleptic Gregorian calendar) instead of `Date`s. That is
 * DST-proof by construction: there is no clock time anywhere, so a 23- or 25-hour day cannot produce a
 * duplicate or missing date. Conversions follow Howard Hinnant's `days_from_civil`/`civil_from_days`.
 */
import type { Availability, DateRange, ISODate, WeekMinutes } from '@/db/types'
import { isISODate } from '../dates'
import type { SchedulerOptions } from './types'

export const DEFAULT_OPTIONS: Readonly<SchedulerOptions> = {
  minChunk: 25,
  maxChunk: 90,
  grain: 5,
  horizonDays: 1095,
  maxCatchUp: 240,
}

/** The ceiling for "required minutes per study day" (16 h). */
export const MAX_REQUIRED_MINUTES = 960

/** Merges partial options over the defaults and sanitises them (positive, grain-aligned, min ≤ max). */
export function resolveOptions(partial: Partial<SchedulerOptions> = {}): SchedulerOptions {
  const pick = (v: number | undefined, d: number): number =>
    v !== undefined && Number.isFinite(v) && v > 0 ? v : d
  const grain = Math.max(1, Math.round(pick(partial.grain, DEFAULT_OPTIONS.grain)))
  const maxChunk = Math.max(grain, floorTo(pick(partial.maxChunk, DEFAULT_OPTIONS.maxChunk), grain))
  const minChunk = Math.min(
    maxChunk,
    Math.max(grain, ceilTo(pick(partial.minChunk, DEFAULT_OPTIONS.minChunk), grain)),
  )
  return {
    grain,
    minChunk,
    maxChunk,
    horizonDays: Math.max(1, Math.round(pick(partial.horizonDays, DEFAULT_OPTIONS.horizonDays))),
    maxCatchUp: floorTo(pick(partial.maxCatchUp, DEFAULT_OPTIONS.maxCatchUp), grain),
  }
}

export function floorTo(n: number, grain: number): number {
  return Math.floor(n / grain) * grain
}

export function ceilTo(n: number, grain: number): number {
  return Math.ceil(n / grain) * grain
}

// ─── Day numbers ────────────────────────────────────────────────────────────

/** Days since 1970-01-01 for a valid `'YYYY-MM-DD'`. Throws `RangeError` on a malformed day. */
export function dayNumber(d: ISODate): number {
  if (!isISODate(d)) throw new RangeError(`Invalid ISODate: ${d}`)
  let y = Number(d.slice(0, 4))
  const m = Number(d.slice(5, 7))
  const day = Number(d.slice(8, 10))
  y -= m <= 2 ? 1 : 0
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n))

/** The `'YYYY-MM-DD'` for a day number. */
export function isoOfDay(n: number): ISODate {
  const z = n + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  )
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0)
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
export function weekdayOfDay(n: number): number {
  return (((n + 4) % 7) + 7) % 7
}

// ─── Availability ───────────────────────────────────────────────────────────

/** The goal's availability plus extra (global) days off. Weekday minutes are copied, not shared. */
export function mergeDaysOff(
  availability: Availability,
  extra: readonly DateRange[] = [],
): Availability {
  return {
    minutesByWeekday: [...availability.minutesByWeekday] as WeekMinutes,
    daysOff: [...availability.daysOff, ...extra],
  }
}

/** Adds `minutes` to every weekday that already has study time (the one-click catch-up). */
export function addMinutesToStudyDays(availability: Availability, minutes: number): Availability {
  return {
    minutesByWeekday: availability.minutesByWeekday.map((m) =>
      m > 0 ? m + minutes : m,
    ) as WeekMinutes,
    daysOff: [...availability.daysOff],
  }
}

/** Weekday capacities floored to the grain; negatives and non-numbers become 0. */
export function weekCaps(minutesByWeekday: readonly number[], grain: number): number[] {
  const out: number[] = []
  for (let i = 0; i < 7; i++) {
    const m = minutesByWeekday[i] ?? 0
    out.push(Number.isFinite(m) && m > 0 ? floorTo(m, grain) : 0)
  }
  return out
}

/** Days-off ranges as inclusive day-number pairs, sorted; malformed or inverted ranges are ignored. */
export function dayRanges(ranges: readonly DateRange[]): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = []
  for (const r of ranges) {
    if (!isISODate(r.start) || !isISODate(r.end)) continue
    const a = dayNumber(r.start)
    const b = dayNumber(r.end)
    if (b >= a) out.push([a, b])
  }
  return out.sort((x, y) => x[0] - y[0] || x[1] - y[1])
}

export function inRanges(day: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [a, b] of ranges) {
    if (a > day) return false
    if (day <= b) return true
  }
  return false
}

/** Days in `[start, end]` (day numbers, inclusive) with weekday capacity that are not days off. */
export function countStudyDays(
  start: number,
  end: number,
  caps: readonly number[],
  off: ReadonlyArray<readonly [number, number]>,
): number {
  let n = 0
  for (let d = start; d <= end; d++) {
    if ((caps[weekdayOfDay(d)] ?? 0) > 0 && !inRanges(d, off)) n++
  }
  return n
}

/** ISODate form of `countStudyDays`, for callers outside the scheduler (the wizard). */
export function studyDaysBetween(
  availability: Availability,
  start: ISODate,
  end: ISODate,
  grain: number = DEFAULT_OPTIONS.grain,
): number {
  return countStudyDays(
    dayNumber(start),
    dayNumber(end),
    weekCaps(availability.minutesByWeekday, grain),
    dayRanges(availability.daysOff),
  )
}
