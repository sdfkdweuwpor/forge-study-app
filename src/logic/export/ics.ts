/**
 * iCalendar (RFC 5545) writer.
 *
 * Time zones: timed events use FLOATING local time (`DTSTART:20261003T140000`, no `Z`, no `TZID`).
 * A floating time means "2 pm wherever the calendar is", which is what a study plan wants and how
 * Forge stores it (wall-clock `HH:mm`). It also makes DST a non-issue: the wall-clock time is
 * written as is and the end is computed on the wall clock, never as an instant. The cost is that
 * the event will not move if the student travels, and a few clients (Google) read floating times
 * in the calendar's own zone. Embedding a VTIMEZONE was rejected: it needs the zone's rules and
 * goes stale. Only DTSTAMP is UTC (`Z`), as the RFC requires.
 */
import { addDays, isHHmm, isISODate, parseHHmm } from '@/logic/dates'

export interface IcsAllDay {
  uid: string
  summary: string
  description?: string
  allDay: true
  /** `YYYY-MM-DD`, first day. */
  date: string
  /** Last day, inclusive; defaults to `date`. The file gets the exclusive DTEND. */
  endDate?: string
}

export interface IcsTimed {
  uid: string
  summary: string
  description?: string
  allDay?: false
  date: string
  /** `HH:mm`. */
  start: string
  durationMinutes: number
}

export type IcsEvent = IcsAllDay | IcsTimed

export interface IcsOptions {
  calName: string
  /** DTSTAMP, epoch ms. Injected so output is deterministic. */
  now: number
}

export const ICS_PRODID = '-//Forge//Study Planner//EN'
const MAX_OCTETS = 75

/** Escapes TEXT values: backslash, semicolon, comma and newlines. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, (m) => `\\${m}`)
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

const encoder = new TextEncoder()

/** Folds a content line at 75 octets (never inside a UTF-8 sequence); continuations start with a space. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= MAX_OCTETS) return line
  const parts: string[] = []
  let current = ''
  let used = 0
  let limit = MAX_OCTETS
  for (const ch of line) {
    const n = encoder.encode(ch).length
    if (used + n > limit) {
      parts.push(current)
      current = ''
      used = 0
      limit = MAX_OCTETS - 1
    }
    current += ch
    used += n
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const compact = (date: string): string => date.replace(/-/g, '')

function stampUtc(ms: number): string {
  const d = new Date(ms)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

/** Wall-clock start plus minutes, rolling into the next day(s) when it passes midnight. */
export function endOfTimed(
  date: string,
  start: string,
  minutes: number,
): { date: string; time: string } {
  const total = (parseHHmm(start) ?? 0) + Math.max(0, Math.round(minutes))
  const days = Math.floor(total / 1440)
  const rest = total % 1440
  const p = (n: number): string => String(n).padStart(2, '0')
  return {
    date: days === 0 ? date : addDays(date, days),
    time: `${p(Math.floor(rest / 60))}${p(rest % 60)}00`,
  }
}

function eventLines(e: IcsEvent, stamp: string): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`]
  if (e.allDay === true) {
    lines.push(`DTSTART;VALUE=DATE:${compact(e.date)}`)
    lines.push(`DTEND;VALUE=DATE:${compact(addDays(e.endDate ?? e.date, 1))}`)
    lines.push('TRANSP:TRANSPARENT')
  } else {
    const end = endOfTimed(e.date, e.start, e.durationMinutes)
    lines.push(`DTSTART:${compact(e.date)}T${e.start.replace(':', '')}00`)
    lines.push(`DTEND:${compact(end.date)}T${end.time}`)
  }
  lines.push(`SUMMARY:${escapeText(e.summary)}`)
  if (e.description !== undefined && e.description !== '') {
    lines.push(`DESCRIPTION:${escapeText(e.description)}`)
  }
  lines.push('END:VEVENT')
  return lines
}

function valid(e: IcsEvent): boolean {
  if (e.uid === '' || !isISODate(e.date)) return false
  if (e.allDay === true)
    return e.endDate === undefined || (isISODate(e.endDate) && e.endDate >= e.date)
  return isHHmm(e.start) && Number.isFinite(e.durationMinutes)
}

/** A complete VCALENDAR with CRLF line endings and a trailing CRLF. Invalid events are skipped. */
export function toIcs(events: readonly IcsEvent[], opts: IcsOptions): string {
  const stamp = stampUtc(opts.now)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.calName)}`,
  ]
  for (const e of events) if (valid(e)) lines.push(...eventLines(e, stamp))
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
