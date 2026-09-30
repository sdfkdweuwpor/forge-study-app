/**
 * Loose date parsing for pasted syllabi (pure). Finds dates in running text: `2026-10-12`, `10/12`,
 * `10/12/2026`, `Oct 12`, `October 12th, 2026`, `Mon, Oct 12`, `12 Oct`, `14 October 2026`. Numeric
 * dates are read month first (US). A date without a year takes the year that puts it no more than 60 days
 * before `today`, so a fall syllabus pasted in September reads "Jan 15" as next January.
 */
import type { ISODate } from '@/db/types'
import { addDays, addMonths, isISODate } from '../dates'

export interface FoundDate {
  date: ISODate
  /** Where the date text starts and ends in the input (for stripping it from a title). */
  index: number
  end: number
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

export const MONTH_NAMES =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'

const pad = (n: number): string => String(n).padStart(2, '0')

/** The ISO date for y-m-d if it exists on the calendar. */
function iso(y: number, m: number, d: number): ISODate | null {
  const s = `${y}-${pad(m)}-${pad(d)}`
  return isISODate(s) ? s : null
}

/** Month and day with no year: this year, unless that is more than 60 days ago, then next year. */
export function inferYear(m: number, d: number, today: ISODate): ISODate | null {
  const y = Number(today.slice(0, 4))
  const here = iso(y, m, d)
  if (here && here >= addDays(today, -60)) return here
  return iso(y + 1, m, d) ?? here
}

function fullYear(y: string | undefined): number | null {
  if (y === undefined) return null
  const n = Number(y)
  return y.length === 2 ? 2000 + n : n
}

function resolve(m: number, d: number, y: number | null, today: ISODate): ISODate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return y === null ? inferYear(m, d, today) : iso(y, m, d)
}

const PATTERNS: ReadonlyArray<{ re: RegExp; read: (m: RegExpExecArray) => [number, number, number | null] }> = [
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, read: (x) => [Number(x[2]), Number(x[3]), Number(x[1])] },
  {
    re: /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g,
    read: (x) => [Number(x[1]), Number(x[2]), fullYear(x[3])],
  },
  {
    re: new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'gi'),
    read: (x) => [MONTHS[(x[1] ?? '').toLowerCase()] ?? 0, Number(x[2]), fullYear(x[3])],
  },
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})\\b\\.?(?:,?\\s+(\\d{4}))?`, 'gi'),
    read: (x) => [MONTHS[(x[2] ?? '').toLowerCase()] ?? 0, Number(x[1]), fullYear(x[3])],
  },
]

/**
 * Every date in `text`, in order of position; overlapping matches keep the earlier, longer one.
 * `numeric: false` skips `10/12`-style dates (a unit title's "Chapters 1/2" is not January 2).
 */
export function findDates(text: string, today: ISODate, opts: { numeric?: boolean } = {}): FoundDate[] {
  const found: FoundDate[] = []
  for (const [i, { re, read }] of PATTERNS.entries()) {
    if (i === 1 && opts.numeric === false) continue
    re.lastIndex = 0
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      const [mo, d, y] = read(m)
      const date = resolve(mo, d, y, today)
      if (date) found.push({ date, index: m.index, end: m.index + m[0].length })
    }
  }
  found.sort((a, b) => a.index - b.index || b.end - a.end)
  const out: FoundDate[] = []
  for (const f of found) {
    const last = out[out.length - 1]
    if (!last || f.index >= last.end) out.push(f)
  }
  return out
}

/** The first date in `text`, or null. */
export function firstDate(text: string, today: ISODate): FoundDate | null {
  return findDates(text, today)[0] ?? null
}

/**
 * A goal's deadline phrase: "by Dec 15", "by June" / "by June 2027" (the month's last day), or "in 6
 * months" / "in 10 weeks" (counted from today). Returns the date and the phrase's position.
 */
export function goalDeadline(text: string, today: ISODate): FoundDate | null {
  const by = /\b(?:by|before|until)\s+/i.exec(text)
  if (by) {
    const rest = text.slice(by.index + by[0].length)
    const d = firstDate(rest, today)
    if (d && d.index === 0) return { date: d.date, index: by.index, end: by.index + by[0].length + d.end }
    const month = new RegExp(`^(${MONTH_NAMES})\\.?(?:\\s+(\\d{4}))?\\b`, 'i').exec(rest)
    if (month) {
      const m = MONTHS[(month[1] ?? '').toLowerCase()] ?? 0
      const y0 = Number(today.slice(0, 4))
      let y = month[2] ? Number(month[2]) : y0
      if (!month[2] && m < Number(today.slice(5, 7))) y += 1
      const last = addDays(addMonths(`${y}-${pad(m)}-01`, 1), -1)
      return { date: last, index: by.index, end: by.index + by[0].length + month[0].length }
    }
  }
  const rel = /\bin\s+(\d{1,3})\s+(days?|weeks?|months?|years?)\b/i.exec(text)
  if (rel) {
    const n = Number(rel[1])
    const unit = (rel[2] ?? '').toLowerCase()
    const date = unit.startsWith('day')
      ? addDays(today, n)
      : unit.startsWith('week')
        ? addDays(today, n * 7)
        : addMonths(today, unit.startsWith('month') ? n : n * 12)
    return { date, index: rel.index, end: rel.index + rel[0].length }
  }
  return null
}
