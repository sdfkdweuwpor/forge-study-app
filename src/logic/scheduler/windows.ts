/**
 * Availability v2 (pure): study windows per weekday or per rotating shift day, blackout ranges and a
 * session length. `capacityForDate` answers "when can I study on this day?".
 *
 * Times are wall-clock minutes after local midnight (0–1440). A window lies inside one day (`'24:00'`
 * may end it); an overnight shift is entered as two windows. On a DST-change day the wall-clock span that
 * is skipped (spring) or repeated (autumn) is removed from the windows, so a session's wall-clock length
 * is always its real length and a session never straddles the change.
 */
import type { Availability, DateRange, HHmm, ISODate } from '@/db/types'
import { dayNumber, dayRanges, inRanges, isoOfDay, weekdayOfDay } from './capacity'
import type {
  AvailabilityV2,
  DayWindows,
  ShiftPattern,
  TimeWindow,
  WeekWindows,
} from './plannerTypes'

/** `[start, end)` in minutes after midnight, or in absolute planner minutes. */
export type Interval = readonly [number, number]

export const DAY_MINUTES = 1440
export const DEFAULT_SESSION_MINUTES = 50
export const MIN_SESSION_MINUTES = 25
export const MAX_SESSION_MINUTES = 90
/** Where a legacy "N minutes on Monday" window starts when no study start is given. */
export const DEFAULT_STUDY_START: HHmm = '18:00'

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Minutes after midnight for `'HH:mm'`, also accepting `'24:00'` (= 1440). `null` when malformed. */
export function parseClock(t: string): number | null {
  if (t === '24:00') return DAY_MINUTES
  const m = CLOCK_RE.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** `'HH:mm'` for 0–1440 minutes; 1440 is `'24:00'`. */
export function formatClock(minutes: number): HHmm {
  const m = Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes)))
  if (m === DAY_MINUTES) return '24:00'
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Sorted, merged (overlapping or touching), clipped to `[lo, hi]`, empty ones dropped. */
export function normalizeIntervals(
  xs: readonly Interval[],
  lo = 0,
  hi: number = DAY_MINUTES,
): Interval[] {
  const clipped = xs
    .map(([a, b]): Interval => [Math.max(lo, a), Math.min(hi, b)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const out: Array<[number, number]> = []
  for (const [a, b] of clipped) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** `base` minus every interval in `cut` (both sorted and disjoint is not required). */
export function subtractIntervals(base: readonly Interval[], cut: readonly Interval[]): Interval[] {
  if (cut.length === 0) return [...base]
  const cuts = normalizeIntervals(cut, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)
  const out: Interval[] = []
  for (const [a, b] of base) {
    let s = a
    for (const [c, d] of cuts) {
      if (d <= s) continue
      if (c >= b) break
      if (c > s) out.push([s, c])
      s = Math.max(s, d)
      if (s >= b) break
    }
    if (s < b) out.push([s, b])
  }
  return out
}

export function intervalMinutes(xs: readonly Interval[]): number {
  let n = 0
  for (const [a, b] of xs) n += b - a
  return n
}

/** Windows as minute intervals, normalized; malformed windows are ignored. */
export function windowsToIntervals(ws: DayWindows | null | undefined): Interval[] {
  if (!ws) return []
  const xs: Interval[] = []
  for (const w of ws) {
    const a = parseClock(w.start)
    const b = parseClock(w.end)
    if (a !== null && b !== null && b > a) xs.push([a, b])
  }
  return normalizeIntervals(xs)
}

export function intervalsToWindows(xs: readonly Interval[]): TimeWindow[] {
  return xs.map(([a, b]) => ({ start: formatClock(a), end: formatClock(b) }))
}

// ─── DST ────────────────────────────────────────────────────────────────────

/**
 * The wall-clock span that does not behave on a DST-change day in the runtime's time zone: the skipped
 * span when clocks go forward (02:00–03:00 in New York on 2027-03-14), the repeated span when they go
 * back (01:00–02:00 on 2026-11-01). `null` on ordinary days.
 */
export function dstShiftOn(day: number): Interval | null {
  const iso = isoOfDay(day)
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7)) - 1
  const d = Number(iso.slice(8, 10))
  const o0 = new Date(y, m, d).getTimezoneOffset()
  const o1 = new Date(y, m, d + 1).getTimezoneOffset()
  if (o0 === o1) return null
  const diff = Math.abs(o0 - o1)
  if (o1 < o0) {
    // Forward: the first wall-clock hour that does not exist resolves to a later hour.
    for (let h = 0; h < 24; h++) {
      if (new Date(y, m, d, h, 0).getHours() !== h)
        return [h * 60, Math.min(DAY_MINUTES, h * 60 + diff)]
    }
    return null
  }
  // Back: the offset changes at wall-clock hour h; the span just before it happens twice.
  for (let h = 1; h <= 24; h++) {
    if (new Date(y, m, d, h, 0).getTimezoneOffset() !== o0)
      return [Math.max(0, h * 60 - diff), h * 60]
  }
  return null
}

// ─── Availability ───────────────────────────────────────────────────────────

const mod = (a: number, n: number): number => ((a % n) + n) % n

/** The shift-cycle day for `day` (0-based), wrapping in both directions. */
export function cycleDay(pattern: ShiftPattern, day: number): number {
  return mod(day - dayNumber(pattern.anchor), pattern.cycle.length)
}

function hasPattern(av: AvailabilityV2): av is AvailabilityV2 & { shiftPattern: ShiftPattern } {
  const p = av.shiftPattern
  return p !== null && p !== undefined && p.cycle.length > 0 && isValidDay(p.anchor)
}

function isValidDay(d: ISODate): boolean {
  try {
    dayNumber(d)
    return true
  } catch {
    return false
  }
}

/** The raw windows for a day before blackouts and DST: the shift cycle's, else the weekday's. */
export function baseWindowsForDay(av: AvailabilityV2, day: number): DayWindows {
  if (hasPattern(av)) return av.shiftPattern.cycle[cycleDay(av.shiftPattern, day)] ?? []
  return av.weekly[weekdayOfDay(day)] ?? []
}

/**
 * Builds a day → intervals function with blackouts parsed once. The result is memoized per day, so the
 * planner can ask for the same day many times across re-runs.
 */
export function makeDayIntervals(av: AvailabilityV2): (day: number) => Interval[] {
  const off = dayRanges(av.blackouts)
  const cache = new Map<number, Interval[]>()
  return (day: number): Interval[] => {
    const hit = cache.get(day)
    if (hit) return hit
    let xs: Interval[] = inRanges(day, off) ? [] : windowsToIntervals(baseWindowsForDay(av, day))
    if (xs.length > 0) {
      const dst = dstShiftOn(day)
      if (dst) xs = subtractIntervals(xs, [dst])
    }
    cache.set(day, xs)
    return xs
  }
}

/** When the user can study on `date`: merged windows, none on a blackout day. */
export function capacityForDate(av: AvailabilityV2, date: ISODate): TimeWindow[] {
  return intervalsToWindows(makeDayIntervals(av)(dayNumber(date)))
}

/** Every distinct day template the availability can produce (weekdays, or the shift cycle's days). */
function templates(av: AvailabilityV2): Interval[][] {
  const days: ReadonlyArray<DayWindows | null> = hasPattern(av) ? av.shiftPattern.cycle : av.weekly
  return days.map((w) => windowsToIntervals(w))
}

/** The longest single window in the pattern (minutes). A session can never be longer. */
export function largestWindowMinutes(av: AvailabilityV2): number {
  let max = 0
  for (const t of templates(av)) for (const [a, b] of t) max = Math.max(max, b - a)
  return max
}

/** The most study time any one day of the pattern offers. */
export function maxDayMinutes(av: AvailabilityV2): number {
  return Math.max(0, ...templates(av).map(intervalMinutes))
}

/** Average study minutes over the pattern's days that have any (0 when none do). */
export function averageStudyDayMinutes(av: AvailabilityV2): number {
  const sums = templates(av)
    .map(intervalMinutes)
    .filter((m) => m > 0)
  return sums.length === 0 ? 0 : sums.reduce((s, m) => s + m, 0) / sums.length
}

/**
 * The v1 model (`minutesByWeekday` + `daysOff`) as windows: each study weekday gets one window of its
 * minutes starting at `studyStart` (moved earlier if it would run past midnight); days off become
 * blackouts.
 */
export function fromLegacyAvailability(
  av: Availability,
  opts: { studyStart?: HHmm; sessionMinutes?: number } = {},
): AvailabilityV2 {
  const start =
    parseClock(opts.studyStart ?? DEFAULT_STUDY_START) ?? parseClock(DEFAULT_STUDY_START)
  const weekly = av.minutesByWeekday.map((raw): DayWindows => {
    const m = Number.isFinite(raw) && raw > 0 ? Math.min(DAY_MINUTES, Math.floor(raw)) : 0
    if (m === 0) return []
    const s = Math.min(start ?? 0, DAY_MINUTES - m)
    return [{ start: formatClock(s), end: formatClock(s + m) }]
  }) as unknown as WeekWindows
  return {
    weekly,
    sessionMinutes: opts.sessionMinutes ?? DEFAULT_SESSION_MINUTES,
    blackouts: [...av.daysOff],
    shiftPattern: null,
  }
}

/** Extends each study day by `minutes`: the last window's end moves later, then the first's start earlier. */
function extendDay(ws: DayWindows | null, minutes: number): DayWindows | null {
  const xs = windowsToIntervals(ws)
  if (xs.length === 0 || minutes <= 0) return ws
  const out = xs.map(([a, b]): [number, number] => [a, b])
  const last = out[out.length - 1] as [number, number]
  const later = Math.min(minutes, DAY_MINUTES - last[1])
  last[1] += later
  const first = out[0] as [number, number]
  first[0] = Math.max(0, first[0] - (minutes - later))
  return intervalsToWindows(normalizeIntervals(out))
}

/** "Add X min to every study day" (the add-time option), on weekday windows and shift days alike. */
export function addMinutesToWindows(av: AvailabilityV2, minutes: number): AvailabilityV2 {
  const weekly = av.weekly.map((w) => extendDay(w, minutes) ?? []) as unknown as WeekWindows
  const shiftPattern = hasPattern(av)
    ? {
        anchor: av.shiftPattern.anchor,
        cycle: av.shiftPattern.cycle.map((w) => extendDay(w, minutes)),
      }
    : (av.shiftPattern ?? null)
  return { ...av, weekly, shiftPattern, blackouts: [...av.blackouts] }
}

/** Adds blackout ranges (global days off, or a "life happened" day). */
export function withBlackouts(av: AvailabilityV2, extra: readonly DateRange[]): AvailabilityV2 {
  return { ...av, blackouts: [...av.blackouts, ...extra] }
}

/**
 * Common rotations, as alternating runs of on/off days starting with "on". "2-2-3" is the 14-day
 * Pitman rotation (2 on, 2 off, 3 on, 2 off, 2 on, 3 off).
 */
export const SHIFT_PRESETS = {
  '3on4off': [3, 4],
  '4on3off': [4, 3],
  '4on4off': [4, 4],
  '5on2off': [5, 2],
  '2-2-3': [2, 2, 3, 2, 2, 3],
} as const satisfies Record<string, readonly number[]>

export type ShiftPresetId = keyof typeof SHIFT_PRESETS

/**
 * A shift cycle from alternating runs (`[3, 4]` = 3 on, 4 off). `onDays` are the windows on work days
 * (often a short evening, or `null` for none), `offDays` those on days off.
 */
export function shiftCycle(
  runs: readonly number[],
  onDays: DayWindows | null,
  offDays: DayWindows | null,
): Array<DayWindows | null> {
  const out: Array<DayWindows | null> = []
  runs.forEach((n, i) => {
    for (let k = 0; k < Math.max(0, Math.floor(n)); k++) out.push(i % 2 === 0 ? onDays : offDays)
  })
  return out
}

/** Every weekday with the same windows (a convenience for tests and the wizard's defaults). */
export function sameEveryDay(
  ws: DayWindows,
  weekdays: readonly number[] = [0, 1, 2, 3, 4, 5, 6],
): WeekWindows {
  return Array.from({ length: 7 }, (_, i) =>
    weekdays.includes(i) ? ws : [],
  ) as unknown as WeekWindows
}
