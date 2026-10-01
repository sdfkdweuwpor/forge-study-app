/** Small formatters for the import preview: availability, hours and term names. */
import { format } from 'date-fns'
import type { DateRange, ISODate, WeekMinutes } from '@/db/types'
import { fromISODate } from '../dates'

/** 120 → "2 h", 90 → "1.5 h", 45 → "45 min", 0 → "0 h". */
export function formatMinutes(minutes: number): string {
  if (minutes > 0 && minutes < 60) return `${Math.round(minutes)} min`
  return `${Math.round((minutes / 60) * 10) / 10} h`
}

/** Monday first, as people read a week; the indexes are `WeekMinutes` (Sunday = 0). */
const MONDAY_FIRST: readonly { name: string; index: number }[] = [
  { name: 'Mon', index: 1 },
  { name: 'Tue', index: 2 },
  { name: 'Wed', index: 3 },
  { name: 'Thu', index: 4 },
  { name: 'Fri', index: 5 },
  { name: 'Sat', index: 6 },
  { name: 'Sun', index: 0 },
]

/** "Mon–Fri 2 h · Sat 3 h · Sun off": runs of days with the same hours are joined. */
export function describeWeek(week: WeekMinutes): string {
  const parts: string[] = []
  let i = 0
  while (i < MONDAY_FIRST.length) {
    const first = MONDAY_FIRST[i]
    if (!first) break
    const minutes = week[first.index] ?? 0
    let j = i
    while (j + 1 < MONDAY_FIRST.length && (week[MONDAY_FIRST[j + 1]?.index ?? 0] ?? 0) === minutes) j++
    const last = MONDAY_FIRST[j] ?? first
    const days = i === j ? first.name : `${first.name}–${last.name}`
    parts.push(minutes > 0 ? `${days} ${formatMinutes(minutes)}` : `${days} off`)
    i = j + 1
  }
  return parts.join(' · ')
}

export function weeklyMinutes(week: WeekMinutes): number {
  return week.reduce<number>((sum, m) => sum + m, 0)
}

export function describeDaysOff(daysOff: readonly DateRange[]): string {
  if (daysOff.length === 0) return 'no days off'
  return daysOff
    .map((r) => (r.start === r.end ? r.start : `${r.start} to ${r.end}`))
    .join(', ')
}

/** "Oct 2026 – Mar 2027" (one month when the term is inside it). */
export function termLabel(start: ISODate, end: ISODate): string {
  const a = format(fromISODate(start), 'MMM yyyy')
  const b = format(fromISODate(end), 'MMM yyyy')
  return a === b ? a : `${a} – ${b}`
}
