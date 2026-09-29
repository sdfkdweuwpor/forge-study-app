/**
 * Recurrence rules (pure). Every step is a whole calendar day via `dates.ts`, so DST changes never
 * shift an occurrence.
 *
 * How a `RecurrenceRule` is read:
 *  - `daily`    every `interval` days.
 *  - `weekdays` Monday to Friday (interval and byWeekday are ignored).
 *  - `weekly`   every `interval` weeks on `byWeekday`; an empty list means the same weekday as the
 *               date being advanced from.
 *  - `custom`   like `weekly` when `byWeekday` is non-empty, otherwise every `interval` days.
 * For multi-week intervals a "week" runs Monday to Sunday.
 */
import type { ISODate, RecurrenceRule } from '@/db/types'
import { addDays, weekdayOf, type Weekday } from './dates'

export const WEEKDAY_NAMES: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]
export const WEEKDAY_SHORT_NAMES: readonly string[] = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
]

function cleanInterval(interval: number): number {
  return Number.isFinite(interval) && interval >= 1 ? Math.floor(interval) : 1
}

/** Valid weekday numbers only (0–6), de-duplicated and ascending. */
function cleanWeekdays(days: readonly number[]): Weekday[] {
  const seen = new Set<number>()
  for (const d of days) if (Number.isInteger(d) && d >= 0 && d <= 6) seen.add(d)
  return [...seen].sort((a, b) => a - b) as Weekday[]
}

/** Position within a Monday-first week: Monday = 0 … Sunday = 6. */
function mondayIndex(weekday: number): number {
  return (weekday + 6) % 7
}

function nextWeekday(from: ISODate): ISODate {
  const wd = weekdayOf(from)
  // Fri → +3, Sat → +2, everything else → +1.
  return addDays(from, wd === 5 ? 3 : wd === 6 ? 2 : 1)
}

function nextInWeeks(from: ISODate, days: readonly number[], interval: number): ISODate {
  const pos = mondayIndex(weekdayOf(from))
  const positions = days.map(mondayIndex).sort((a, b) => a - b)
  const later = positions.find((p) => p > pos)
  if (later !== undefined) return addDays(from, later - pos)
  const first = positions[0] ?? pos
  return addDays(from, -pos + 7 * interval + first)
}

/** The occurrence strictly after `fromDate` (the due date of the instance just completed). */
export function nextOccurrence(rule: RecurrenceRule, fromDate: ISODate): ISODate {
  const interval = cleanInterval(rule.interval)
  const days = cleanWeekdays(rule.byWeekday)
  switch (rule.freq) {
    case 'daily':
      return addDays(fromDate, interval)
    case 'weekdays':
      return nextWeekday(fromDate)
    case 'weekly':
      return nextInWeeks(fromDate, days.length > 0 ? days : [weekdayOf(fromDate)], interval)
    case 'custom':
      return days.length > 0 ? nextInWeeks(fromDate, days, interval) : addDays(fromDate, interval)
  }
}

/** The next `count` occurrences after `fromDate`, for previews. */
export function nextOccurrences(rule: RecurrenceRule, fromDate: ISODate, count: number): ISODate[] {
  const out: ISODate[] = []
  let cursor = fromDate
  for (let i = 0; i < count; i++) {
    cursor = nextOccurrence(rule, cursor)
    out.push(cursor)
  }
  return out
}

/**
 * The first day on or after `from` that fits the rule's weekday pattern. Rules with no weekday
 * pattern (every N days, every N weeks with no weekday) start on `from` itself. Used to anchor a
 * brand-new recurring task that has no due date yet ("every monday" typed on a Tuesday).
 */
export function firstOccurrence(rule: RecurrenceRule, from: ISODate): ISODate {
  const wd = weekdayOf(from)
  const days = cleanWeekdays(rule.byWeekday)
  const constrained =
    rule.freq === 'weekdays' ||
    ((rule.freq === 'weekly' || rule.freq === 'custom') && days.length > 0)
  if (!constrained) return from
  if (rule.freq === 'weekdays') return wd >= 1 && wd <= 5 ? from : nextWeekday(from)
  if (days.includes(wd)) return from
  return nextInWeeks(from, days, 1)
}

function joinDays(days: readonly number[]): string {
  if (days.length === 1) return WEEKDAY_NAMES[days[0] ?? 0] ?? ''
  return days.map((d) => WEEKDAY_SHORT_NAMES[d] ?? '').join(', ')
}

function isWeekdaySet(days: readonly number[]): boolean {
  return days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))
}

/** Human label: "Every day", "Every weekday", "Every Monday", "Every Mon, Wed, Fri", "Every 2 weeks". */
export function describeRecurrence(rule: RecurrenceRule): string {
  const interval = cleanInterval(rule.interval)
  const days = cleanWeekdays(rule.byWeekday)
  const everyDays = (n: number): string => (n === 1 ? 'Every day' : `Every ${n} days`)
  const everyWeeks = (n: number): string => (n === 1 ? 'Every week' : `Every ${n} weeks`)

  switch (rule.freq) {
    case 'daily':
      return everyDays(interval)
    case 'weekdays':
      return 'Every weekday'
    case 'weekly':
    case 'custom': {
      if (days.length === 0) {
        return rule.freq === 'weekly' ? everyWeeks(interval) : everyDays(interval)
      }
      if (interval === 1) {
        if (days.length === 7) return 'Every day'
        if (isWeekdaySet(days)) return 'Every weekday'
        return `Every ${joinDays(days)}`
      }
      return `${everyWeeks(interval)} on ${joinDays(days)}`
    }
  }
}
