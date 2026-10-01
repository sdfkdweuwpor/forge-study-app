/**
 * Calendar-day helpers (pure). A calendar day is a local `'YYYY-MM-DD'` string (`ISODate`); an
 * instant is epoch ms. All arithmetic goes through date-fns on *local* dates, so days are always
 * whole calendar days, including across DST changes (23 h / 25 h days).
 *
 * Never use `new Date('YYYY-MM-DD')`: it parses as UTC midnight and lands on the previous local day
 * west of Greenwich. Use `fromISODate` instead.
 */
import {
  addDays as dfAddDays,
  addMonths as dfAddMonths,
  differenceInCalendarDays,
  format,
  startOfWeek,
} from 'date-fns'
import type { DateRange, HHmm, ISODate, Millis } from '@/db/types'

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type WeekStart = 0 | 1

function parts(d: string): [number, number, number] | null {
  const m = ISO_DATE_RE.exec(d)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const day = Number(m[3])
  if (y < 1000 || mo < 1 || mo > 12 || day < 1 || day > 31) return null
  const probe = new Date(y, mo - 1, day)
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== day)
    return null
  return [y, mo, day]
}

/** True for a real calendar date in `'YYYY-MM-DD'` form (rejects `2026-02-30`). */
export function isISODate(value: unknown): value is ISODate {
  return typeof value === 'string' && parts(value) !== null
}

/** Local midnight of `d` (or the first existing instant of that day). Throws on a malformed day. */
export function fromISODate(d: ISODate): Date {
  const p = parts(d)
  if (!p) throw new RangeError(`Invalid ISODate: ${d}`)
  return new Date(p[0], p[1] - 1, p[2])
}

/** The local calendar day of a Date. */
export function toISODate(date: Date): ISODate {
  return format(date, 'yyyy-MM-dd')
}

/** The local calendar day an instant falls on. */
export function dayOf(ms: Millis): ISODate {
  return format(ms, 'yyyy-MM-dd')
}

export function addDays(d: ISODate, n: number): ISODate {
  return toISODate(dfAddDays(fromISODate(d), n))
}

/** Calendar months; clamps to the month's last day (Jan 31 + 1 → Feb 28/29). */
export function addMonths(d: ISODate, n: number): ISODate {
  return toISODate(dfAddMonths(fromISODate(d), n))
}

/** Whole calendar days from `b` to `a` (`a − b`); positive when `a` is later. */
export function diffDays(a: ISODate, b: ISODate): number {
  return differenceInCalendarDays(fromISODate(a), fromISODate(b))
}

/** ISODate strings sort lexicographically; this is just a typed comparator. */
export function compareISODate(a: ISODate, b: ISODate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0
}

export function minISODate(first: ISODate, ...rest: ISODate[]): ISODate {
  return rest.reduce((m, d) => (d < m ? d : m), first)
}

export function maxISODate(first: ISODate, ...rest: ISODate[]): ISODate {
  return rest.reduce((m, d) => (d > m ? d : m), first)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(d: ISODate): Weekday {
  return fromISODate(d).getDay() as Weekday
}

export function startOfWeekISO(d: ISODate, weekStartsOn: WeekStart): ISODate {
  return toISODate(startOfWeek(fromISODate(d), { weekStartsOn }))
}

export function endOfWeekISO(d: ISODate, weekStartsOn: WeekStart): ISODate {
  return addDays(startOfWeekISO(d, weekStartsOn), 6)
}

/** Every day from `start` to `end`, inclusive. Empty when `end < start`. */
export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const n = diffDays(end, start)
  const out: ISODate[] = []
  if (n < 0) return out
  const base = fromISODate(start)
  for (let i = 0; i <= n; i++) out.push(toISODate(dfAddDays(base, i)))
  return out
}

/** Inclusive on both ends. */
export function isInRange(d: ISODate, range: DateRange): boolean {
  return d >= range.start && d <= range.end
}

export function isInAnyRange(d: ISODate, ranges: readonly DateRange[]): boolean {
  return ranges.some((r) => isInRange(d, r))
}

/** First instant of the local day. */
export function dayStartMs(d: ISODate): Millis {
  return fromISODate(d).getTime()
}

/** First instant of the *next* local day (exclusive end). A day may be 23, 24 or 25 hours. */
export function dayEndMs(d: ISODate): Millis {
  return dayStartMs(addDays(d, 1))
}

/** When the local day containing `now` ends (for midnight-rollover timers). */
export function nextDayStartMs(now: Millis): Millis {
  return dayEndMs(dayOf(now))
}

export function isHHmm(value: unknown): value is HHmm {
  return typeof value === 'string' && HHMM_RE.test(value)
}

/** Minutes after midnight for `'HH:mm'`, or null when malformed. */
export function parseHHmm(t: string): number | null {
  const m = HHMM_RE.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** `'HH:mm'` for minutes after midnight (wraps into 0–1439). */
export function toHHmm(minutes: number): HHmm {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * The instant of wall-clock time `t` on day `d`. A time inside a spring-forward gap (02:30 on the
 * DST start day) resolves to the equivalent later instant (03:30), as the platform does.
 */
export function atTime(d: ISODate, t: HHmm): Millis {
  const p = parts(d)
  const mins = parseHHmm(t)
  if (!p) throw new RangeError(`Invalid ISODate: ${d}`)
  if (mins === null) throw new RangeError(`Invalid HH:mm: ${t}`)
  return new Date(p[0], p[1] - 1, p[2], Math.floor(mins / 60), mins % 60).getTime()
}

/** Local wall-clock hour (0–23) of an instant. */
export function hourOf(ms: Millis): number {
  return new Date(ms).getHours()
}

/** Local wall-clock minutes after midnight of an instant. */
export function minutesOfDay(ms: Millis): number {
  const dt = new Date(ms)
  return dt.getHours() * 60 + dt.getMinutes()
}
