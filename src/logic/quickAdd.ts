/**
 * Natural-language quick add (pure): `Read chapter 4 tomorrow 2p #C182 !high ~2` →
 * title "Read chapter 4", planned for tomorrow 14:00, tag/course C182, high priority, 2 pomodoros.
 *
 * Dates (schema v2): a plain date or time is when to do it (`when` → `doDate`/`doTime`); a date after
 * `due`, `by` or `deadline` is a hard deadline (`deadline` → `dueDate`/`dueTime`): "pay bill Fri" is
 * planned for Friday, "pay bill due Fri" must be done by Friday. A time right after a deadline date, or
 * after `by`/`due`, belongs to the deadline ("due Fri 5pm", "by 5pm").
 *
 * The parser scans whitespace-separated words left to right and tries a fixed list of matchers at
 * each one (quoted literal, tag, priority, estimate, recurrence, date, time). It is deliberately
 * conservative: a phrase is only a token when it is unambiguous, so ordinary titles ("Read chapter
 * 4", "Study the sun", "Problem 2a") are left alone. Wrap anything in double quotes to keep it
 * verbatim ("call 'tomorrow' bakery").
 *
 * Recognised (case-insensitive unless noted):
 *  - `#tag` (needs a letter, so `#42` is not a tag); `#C182` also sets `courseCode` when it matches
 *    `knownCourseCodes`.
 *  - `!low !med !medium !high !urgent` or `!1`…`!4`.
 *  - `~N` pomodoros (1–99), unless a time unit follows (`~5 minutes`).
 *  - Dates: today, `tod` (lowercase), tonight, tomorrow, tmr, weekday names (the next one *after*
 *    today), `next week` (first day of next week), `next <weekday>` (that day of next week),
 *    `in N days|weeks`, `sep 30`, `9/30` (also `9/30/2026`), `2026-10-03`. Month-day and M/D dates that
 *    already passed this year roll to next year. A leading `on` is absorbed; a leading `due`, `by` or
 *    `deadline` is absorbed and makes it the deadline.
 *  - Times: `2p`, `2pm`, `2 pm`, `2:30pm`, `14:00`, `noon`, `at 9`, `@9`. Without am/pm, hours 1–6 read
 *    as PM (`at 3`, `3:30` → 15:xx), 7–11 as AM, 12–23 as typed; write `03:30` for 3 AM. `Na` (no "m")
 *    only counts after `at`/`@` or a date word, so "Problem 2a" stays a title. A bare `at N` only
 *    counts at the end of the title or before another token ("Look at 9 examples" is left alone).
 *    A leading `by`/`due` is absorbed and makes it the deadline's time (`by 5pm`).
 *  - Recurrence: every day, every weekday, every week, every monday (also `every mon, wed and fri`),
 *    every 2 days|weeks, every other day|week. The bare words daily, everyday, weekdays and weekly
 *    are ordinary words too, so they only count after at least one title word and when nothing but
 *    other tokens follows ("Water plants daily #home"); "Weekly review" and "Daily standup notes"
 *    keep their words. A recurring task with no date is due on its first occurrence on or after today.
 *  - Abbreviations that are also ordinary words (`sun`, `sat`, `wed`) only count with context (`on
 *    sat`, `by wed`, `sun 2pm`); `may` and the other months only count with a day number after.
 *  - `M/D` is a date unless "of" follows, so "read 1/2 of the chapter" stays a title.
 *
 * Only the first date, time, deadline, priority, estimate and recurrence count; later ones stay in the
 * title. A time with no date is for today (a deadline time with no deadline date is on the do date,
 * else today). Token spans are offsets into the original input.
 */
import { format } from 'date-fns'
import type { HHmm, ISODate, Priority, RecurrenceRule } from '@/db/types'
import {
  addDays,
  dayOf,
  fromISODate,
  isISODate,
  startOfWeekISO,
  toHHmm,
  weekdayOf,
  type WeekStart,
} from './dates'
import { describeRecurrence, firstOccurrence } from './recurrence'
import { normalizeTag } from './tagColor'
import { PRIORITY_LABELS } from './taskQuery'

export type QuickAddTokenKind =
  'date' | 'time' | 'deadline' | 'tag' | 'priority' | 'estimate' | 'recurrence' | 'literal'

export interface QuickAddToken {
  kind: QuickAddTokenKind
  /** Offsets into the original input, `[start, end)`. */
  start: number
  end: number
  /** `input.slice(start, end)`. */
  text: string
  /** What a chip shows: "Tomorrow", "2:00 PM", "Due Fri", "#C182", "High priority", "2 pomodoros". */
  label: string
}

export interface QuickAddContext {
  /** The current instant (epoch ms); "today" is the local day it falls on. */
  now: number
  /** `#code` matching one of these (any case) also sets `courseCode`. */
  knownCourseCodes?: string[]
  /** Only used to normalise a tag's spelling to the existing one. */
  knownTags?: string[]
  /** 0 = Sunday, 1 = Monday (default); decides where "next week" starts. */
  weekStartsOn?: 0 | 1
}

export interface QuickAddResult {
  /** The input minus recognised tokens, whitespace collapsed. May be empty. */
  title: string
  /** When to do it: the task's `doDate`/`doTime`. */
  when?: { date: ISODate; time?: HHmm }
  /** A hard deadline: the task's `dueDate`/`dueTime`. */
  deadline?: { date: ISODate; time?: HHmm }
  tags: string[]
  priority?: Priority
  /** Pomodoros. */
  estimate?: number
  recurrence?: RecurrenceRule
  courseCode?: string
  tokens: QuickAddToken[]
}

// ─── Words ──────────────────────────────────────────────────────────────────

interface Word {
  quoted: boolean
  /** Text of a quoted literal, without the quotes. */
  inner: string
  /** The word without trailing `, . ; :`. */
  core: string
  lower: string
  trailing: string
  /** `[start, end)` of `core` (or of the whole quoted segment). */
  start: number
  end: number
}

const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch)

/** Index of the closing quote for an opener whose content starts at `from`, or -1. */
function findClosingQuote(input: string, from: number, close: string): number {
  for (let j = from; j < input.length; j++) {
    if (input[j] !== close) continue
    const next = input[j + 1]
    if (j > from && (next === undefined || isSpace(next) || ',.;:!?)'.includes(next))) return j
  }
  return -1
}

function tokenize(input: string): Word[] {
  const words: Word[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i] as string
    if (isSpace(ch)) {
      i++
      continue
    }
    if (ch === '"' || ch === '“') {
      const close = findClosingQuote(input, i + 1, ch === '"' ? '"' : '”')
      if (close !== -1) {
        words.push({
          quoted: true,
          inner: input.slice(i + 1, close),
          core: '',
          lower: '',
          trailing: '',
          start: i,
          end: close + 1,
        })
        i = close + 1
        continue
      }
    }
    let j = i
    while (j < input.length && !isSpace(input[j])) j++
    const raw = input.slice(i, j)
    let trailing = /[,.;:]+$/.exec(raw)?.[0] ?? ''
    if (trailing.length === raw.length) trailing = ''
    const core = raw.slice(0, raw.length - trailing.length)
    words.push({
      quoted: false,
      inner: '',
      core,
      lower: core.toLowerCase(),
      trailing,
      start: i,
      end: i + core.length,
    })
    i = j
  }
  return words
}

// ─── Vocabulary ─────────────────────────────────────────────────────────────

const WEEKDAY_FULL = new Map<string, number>([
  ['sunday', 0],
  ['monday', 1],
  ['tuesday', 2],
  ['wednesday', 3],
  ['thursday', 4],
  ['friday', 5],
  ['saturday', 6],
])
const WEEKDAY_ABBR = new Map<string, number>([
  ['sun', 0],
  ['mon', 1],
  ['tue', 2],
  ['tues', 2],
  ['wed', 3],
  ['thu', 4],
  ['thur', 4],
  ['thurs', 4],
  ['fri', 5],
  ['sat', 6],
])
/** Abbreviations that are also everyday words: only recognised with context. */
const RISKY_ABBR = new Set(['sun', 'wed', 'sat'])

const MONTHS = new Map<string, number>([
  ['january', 1],
  ['jan', 1],
  ['february', 2],
  ['feb', 2],
  ['march', 3],
  ['mar', 3],
  ['april', 4],
  ['apr', 4],
  ['may', 5],
  ['june', 6],
  ['jun', 6],
  ['july', 7],
  ['jul', 7],
  ['august', 8],
  ['aug', 8],
  ['september', 9],
  ['sep', 9],
  ['sept', 9],
  ['october', 10],
  ['oct', 10],
  ['november', 11],
  ['nov', 11],
  ['december', 12],
  ['dec', 12],
])

const PRIORITY_WORDS = new Map<string, Priority>([
  ['low', 1],
  ['med', 2],
  ['medium', 2],
  ['high', 3],
  ['urgent', 4],
  ['1', 1],
  ['2', 2],
  ['3', 3],
  ['4', 4],
])

const DATE_CONNECTORS = new Set(['on', 'by', 'due', 'deadline'])
const TIME_CONNECTORS = new Set(['by', 'due'])
/** Connectors that make the date or time after them a deadline. */
const DEADLINE_CONNECTORS = new Set(['by', 'due', 'deadline'])
const DURATION_UNITS = new Set([
  'min',
  'mins',
  'minute',
  'minutes',
  'h',
  'hr',
  'hrs',
  'hour',
  'hours',
])

const TAG_RE = /^#([\p{L}\p{N}](?:[\p{L}\p{N}_\-/]*[\p{L}\p{N}])?)$/u
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/
const SLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?$/
const DAY_NUMBER_RE = /^(\d{1,2})(?:st|nd|rd|th)?$/
const CLOCK_RE = /^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/

function weekdayIndex(lower: string, abbreviations: boolean): number | undefined {
  return WEEKDAY_FULL.get(lower) ?? (abbreviations ? WEEKDAY_ABBR.get(lower) : undefined)
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

// ─── Internal token model ───────────────────────────────────────────────────

type Payload =
  | { kind: 'date'; date: ISODate; deadline?: boolean }
  | { kind: 'time'; time: HHmm; deadline?: boolean }
  | { kind: 'tag'; tag: string }
  | { kind: 'priority'; priority: Priority }
  | { kind: 'estimate'; pomodoros: number }
  | { kind: 'recurrence'; rule: RecurrenceRule }
  | { kind: 'literal'; text: string }

interface Match {
  payload: Payload
  label: string
  /** Words consumed, starting at the word being matched. */
  count: number
  /** The match includes its own `at`/`@` prefix. */
  viaAt?: boolean
}

interface Found {
  payload: Payload
  label: string
  start: number
  end: number
  /** Where the title text resumes: `end` plus punctuation trailing the last word (kept for literals). */
  dropEnd: number
  firstWord: number
  lastWord: number
}

interface Clock {
  minutes: number
  count: number
  weak: boolean
}

// ─── Parser ─────────────────────────────────────────────────────────────────

export function parseQuickAdd(input: string, ctx: QuickAddContext): QuickAddResult {
  const today = dayOf(ctx.now)
  const weekStartsOn: WeekStart = ctx.weekStartsOn ?? 1
  const words = tokenize(input)
  const owner: number[] = words.map(() => -1)
  const found: Found[] = []
  const taken = {
    date: false,
    time: false,
    deadlineDate: false,
    deadlineTime: false,
    priority: false,
    estimate: false,
    recurrence: false,
  }

  const canonicalTag = new Map<string, string>()
  for (const known of [...(ctx.knownCourseCodes ?? []), ...(ctx.knownTags ?? [])]) {
    const spelled = known.trim().replace(/^#+/, '')
    const key = normalizeTag(spelled)
    if (key !== '' && !canonicalTag.has(key)) canonicalTag.set(key, spelled)
  }

  const wordAt = (i: number): Word | undefined => {
    const w = words[i]
    return w && !w.quoted ? w : undefined
  }
  /** A word that continues a phrase: the previous word must not end in punctuation. */
  const nextWord = (i: number): Word | undefined =>
    words[i - 1]?.trailing === '' ? wordAt(i) : undefined

  const dateLabel = (date: ISODate): string => {
    if (date === today) return 'Today'
    if (date === addDays(today, 1)) return 'Tomorrow'
    const sameYear = date.slice(0, 4) === today.slice(0, 4)
    return format(fromISODate(date), sameYear ? 'EEE, MMM d' : 'EEE, MMM d, yyyy')
  }
  const dateMatch = (date: ISODate, count: number, label?: string): Match => ({
    payload: { kind: 'date', date },
    label: label ?? dateLabel(date),
    count,
  })

  /** First day on or after today with this month/day (rolls into next year; skips missing Feb 29). */
  const monthDay = (month: number, day: number): ISODate | null => {
    const thisYear = Number(today.slice(0, 4))
    for (let year = thisYear; year <= thisYear + 8; year++) {
      const iso = `${year}-${pad2(month)}-${pad2(day)}`
      if (isISODate(iso) && iso >= today) return iso
    }
    return null
  }

  const weekdayAfterToday = (weekday: number): ISODate =>
    addDays(today, ((weekday - weekdayOf(today) + 6) % 7) + 1)

  const prevIsDate = (i: number): boolean => {
    const o = owner[i - 1]
    return o !== undefined && o >= 0 && found[o]?.payload.kind === 'date'
  }
  /** The date just before `i` is a deadline ("due Fri" then "5pm"). */
  const prevIsDeadlineDate = (i: number): boolean => {
    const o = owner[i - 1]
    const p = o !== undefined && o >= 0 ? found[o]?.payload : undefined
    return p?.kind === 'date' && p.deadline === true
  }
  /** The word before `i` is a free `due`/`by`/`deadline` that the token at `i` would absorb. */
  const deadlineWordBefore = (i: number): boolean => {
    const before = words[i - 1]
    return (
      i > 0 &&
      before !== undefined &&
      !before.quoted &&
      owner[i - 1] === -1 &&
      before.trailing === '' &&
      DEADLINE_CONNECTORS.has(before.lower)
    )
  }

  // ── time ──

  /** Parses `text` (a lower-cased word, or the rest of an `@` word) as a clock time. */
  const clockFrom = (
    text: string,
    trailing: string,
    following: Word | undefined,
    at: boolean,
    afterDate: boolean,
  ): Clock | null => {
    if (text === 'noon') return { minutes: 720, count: 1, weak: false }
    const m = CLOCK_RE.exec(text)
    if (!m) return null
    const hourText = m[1] as string
    const minuteText = m[2]
    let meridiem = m[3]
    let count = 1
    const minute = minuteText === undefined ? 0 : Number(minuteText)
    if (minute > 59) return null
    let hour = Number(hourText)

    if (meridiem === undefined && trailing === '' && following) {
      if (following.lower === 'am' || following.lower === 'pm') {
        meridiem = following.lower
        count = 2
      }
    }
    if (meridiem !== undefined) {
      if (meridiem === 'a' && !(at || minuteText !== undefined || afterDate)) return null
      if (hour < 1 || hour > 12) return null
      hour = (hour % 12) + (meridiem.startsWith('p') ? 12 : 0)
      return { minutes: hour * 60 + minute, count, weak: false }
    }
    if (minuteText === undefined && !at) return null // a bare number is not a time
    if (hour > 23 || (minuteText === undefined && hour === 0)) return null
    const leadingZero = hourText.length === 2 && hourText.startsWith('0')
    if (hour >= 1 && hour <= 6 && !leadingZero) hour += 12
    return { minutes: hour * 60 + minute, count, weak: minuteText === undefined }
  }

  const clockAt = (j: number, at: boolean, afterDate: boolean): Clock | null => {
    const w = wordAt(j)
    if (!w) return null
    return clockFrom(w.lower, w.trailing, wordAt(j + 1), at, afterDate)
  }

  /** A bare "at 9" only counts when nothing ordinary follows it ("Look at 9 examples" stays a title). */
  const timeMatch = (k: number, clock: Clock, count: number, viaAt: boolean): Match | null => {
    if (clock.weak && k + count < words.length && !startsToken(k + count)) return null
    const deadline = prevIsDeadlineDate(k) || (!viaAt && deadlineWordBefore(k))
    if (deadline ? taken.deadlineTime : taken.time) return null
    return {
      payload: { kind: 'time', time: toHHmm(clock.minutes), ...(deadline ? { deadline } : {}) },
      label: deadline ? `Due by ${timeLabel(clock.minutes)}` : timeLabel(clock.minutes),
      count,
      viaAt,
    }
  }

  const matchTime = (k: number): Match | null => {
    if (taken.time && taken.deadlineTime) return null
    const w = wordAt(k)
    if (!w) return null
    if (w.lower === 'at' && w.trailing === '') {
      const clock = nextWord(k + 1) ? clockAt(k + 1, true, prevIsDate(k)) : null
      return clock ? timeMatch(k, clock, 1 + clock.count, true) : null
    }
    if (w.lower.length > 1 && w.lower.startsWith('@')) {
      const clock = clockFrom(w.lower.slice(1), w.trailing, wordAt(k + 1), true, prevIsDate(k))
      return clock ? timeMatch(k, clock, clock.count, true) : null
    }
    const clock = clockAt(k, false, prevIsDate(k))
    return clock ? timeMatch(k, clock, clock.count, false) : null
  }

  // ── date ──

  const matchWeekday = (k: number, w: Word): Match | null => {
    const full = WEEKDAY_FULL.get(w.lower)
    if (full !== undefined) return dateMatch(weekdayAfterToday(full), 1)
    const abbr = WEEKDAY_ABBR.get(w.lower)
    if (abbr === undefined) return null
    if (RISKY_ABBR.has(w.lower)) {
      const before = words[k - 1]
      const connector =
        before !== undefined &&
        !before.quoted &&
        before.trailing === '' &&
        DATE_CONNECTORS.has(before.lower)
      const timeFollows = w.trailing === '' && clockAt(k + 1, false, true) !== null
      if (!(connector || timeFollows)) return null
    }
    return dateMatch(weekdayAfterToday(abbr), 1)
  }

  const matchDate = (k: number): Match | null => {
    const deadline = deadlineWordBefore(k)
    if (deadline ? taken.deadlineDate : taken.date) return null
    const hit = matchDateWords(k)
    if (!hit || hit.payload.kind !== 'date') return hit
    if (!deadline) return hit
    return {
      ...hit,
      payload: { ...hit.payload, deadline: true },
      label: `Due ${/^(Today|Tonight|Tomorrow)$/.test(hit.label) ? hit.label.toLowerCase() : hit.label}`,
    }
  }

  const matchDateWords = (k: number): Match | null => {
    const w = wordAt(k)
    if (!w) return null
    const l = w.lower

    if (ISO_RE.test(l)) return isISODate(l) ? dateMatch(l, 1) : null

    const slash = SLASH_DATE_RE.exec(l)
    if (slash) {
      if (slash[3] === undefined && wordAt(k + 1)?.lower === 'of') return null // a fraction
      const month = Number(slash[1])
      const day = Number(slash[2])
      const yearText = slash[3]
      if (yearText === undefined) {
        const iso = monthDay(month, day)
        return iso ? dateMatch(iso, 1) : null
      }
      const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)
      const iso = `${year}-${pad2(month)}-${pad2(day)}`
      return isISODate(iso) ? dateMatch(iso, 1) : null
    }

    if (l === 'today' || (l === 'tod' && w.core === 'tod')) return dateMatch(today, 1, 'Today')
    if (l === 'tonight') return dateMatch(today, 1, 'Tonight')
    if (l === 'tomorrow' || l === 'tmr' || l === 'tmrw')
      return dateMatch(addDays(today, 1), 1, 'Tomorrow')

    if (l === 'next') {
      const a = nextWord(k + 1)
      if (!a) return null
      const nextWeekStart = addDays(startOfWeekISO(today, weekStartsOn), 7)
      if (a.lower === 'week') return dateMatch(nextWeekStart, 2)
      const weekday = weekdayIndex(a.lower, true)
      if (weekday === undefined) return null
      return dateMatch(addDays(nextWeekStart, (weekday - weekStartsOn + 7) % 7), 2)
    }

    if (l === 'in') {
      const n = nextWord(k + 1)
      const unit = nextWord(k + 2)
      if (!n || !unit || !/^\d{1,3}$/.test(n.lower)) return null
      const amount = Number(n.lower)
      const perUnit =
        unit.lower === 'day' || unit.lower === 'days'
          ? 1
          : unit.lower === 'week' || unit.lower === 'weeks'
            ? 7
            : 0
      if (amount < 1 || perUnit === 0) return null
      return dateMatch(addDays(today, amount * perUnit), 3)
    }

    const month = MONTHS.get(l)
    if (month !== undefined) {
      const a = nextWord(k + 1)
      const day = a ? DAY_NUMBER_RE.exec(a.lower) : null
      if (!day) return null
      const iso = monthDay(month, Number(day[1]))
      return iso ? dateMatch(iso, 2) : null
    }

    return matchWeekday(k, w)
  }

  // ── recurrence ──

  const rule = (
    freq: RecurrenceRule['freq'],
    interval: number,
    byWeekday: number[],
  ): RecurrenceRule => ({
    freq,
    interval,
    byWeekday,
  })
  const recurrenceMatch = (r: RecurrenceRule, count: number): Match => ({
    payload: { kind: 'recurrence', rule: r },
    label: describeRecurrence(r),
    count,
  })

  const matchEvery = (k: number): Match | null => {
    const every = wordAt(k)
    if (!every || every.trailing !== '') return null
    const a = wordAt(k + 1)
    if (!a) return null
    const unitRule = (unit: string, n: number): RecurrenceRule | null => {
      if (unit === 'day' || unit === 'days') return rule('daily', n, [])
      if (unit === 'week' || unit === 'weeks') return rule('weekly', n, [])
      return null
    }

    if (a.lower === 'weekday' || a.lower === 'weekdays')
      return recurrenceMatch(rule('weekdays', 1, []), 2)
    if (a.trailing === '' && a.lower === 'other') {
      const unit = nextWord(k + 2)
      const r = unit ? unitRule(unit.lower, 2) : null
      return r ? recurrenceMatch(r, 3) : null
    }
    if (a.trailing === '' && /^\d{1,3}$/.test(a.lower)) {
      const unit = nextWord(k + 2)
      const n = Number(a.lower)
      const r = unit && n >= 1 ? unitRule(unit.lower, n) : null
      return r ? recurrenceMatch(r, 3) : null
    }
    const single = unitRule(a.lower, 1)
    if (single && (a.lower === 'day' || a.lower === 'week')) return recurrenceMatch(single, 2)

    // Weekday list: "every mon", "every mon, wed and fri", "every monday tuesday".
    const days: number[] = []
    let j = k + 1
    for (;;) {
      const w = wordAt(j)
      const weekday = w ? weekdayIndex(w.lower, true) : undefined
      if (!w || weekday === undefined) break
      days.push(weekday)
      j++
      if (w.trailing !== '' && w.trailing !== ',') break
      const joiner = wordAt(j)
      const after = wordAt(j + 1)
      if (
        joiner &&
        (joiner.lower === 'and' || joiner.lower === '&') &&
        joiner.trailing === '' &&
        after &&
        weekdayIndex(after.lower, true) !== undefined
      ) {
        j++
      }
    }
    if (days.length === 0) return null
    const unique = [...new Set(days)].sort((x, y) => x - y)
    const isWorkWeek = unique.length === 5 && unique.every((d, index) => d === index + 1)
    return recurrenceMatch(isWorkWeek ? rule('weekdays', 1, []) : rule('weekly', 1, unique), j - k)
  }

  /** The bare one-word forms. They are ordinary words too ("Weekly review"), so they need context. */
  const bareRecurrence = (lower: string): RecurrenceRule | null =>
    lower === 'daily' || lower === 'everyday'
      ? rule('daily', 1, [])
      : lower === 'weekdays'
        ? rule('weekdays', 1, [])
        : lower === 'weekly'
          ? rule('weekly', 1, [])
          : null

  /**
   * Whether a bare `daily`/`weekly`/`weekdays` at word `k` is a recurrence: a title word must come
   * before it, and everything after it must be a token too ("Water plants daily #home"). Otherwise
   * it belongs to the title ("Weekly review", "Daily standup notes", "Review weekly notes").
   */
  const bareRecurrenceFits = (k: number): boolean => {
    let titleWordBefore = false
    for (let i = 0; i < k && !titleWordBefore; i++) {
      const o = owner[i] ?? -1
      titleWordBefore = o === -1 || found[o]?.payload.kind === 'literal'
    }
    if (!titleWordBefore) return false

    // Walk the tail as the scan would, pretending each single-use token is taken as it goes. That
    // includes a recurrence: a second `daily` after one that fits is not a token, and marking it
    // taken keeps a run of repeated words linear (each nested check would otherwise try every
    // later word again, doubling the work per repeated word).
    const saved = { ...taken }
    let onlyTokens = true
    for (let j = k + 1; j < words.length;) {
      if (words[j]?.quoted) {
        j++
        continue
      }
      const m = matchAny(j)
      if (!m) {
        onlyTokens = false
        break
      }
      const kind = m.payload.kind
      if (kind !== 'tag' && kind !== 'literal') taken[kind] = true
      j += m.count
    }
    Object.assign(taken, saved)
    return onlyTokens
  }

  const matchRecurrence = (k: number): Match | null => {
    if (taken.recurrence) return null
    const w = wordAt(k)
    if (!w) return null
    if (w.lower === 'every') return matchEvery(k)
    const bare = bareRecurrence(w.lower)
    return bare && bareRecurrenceFits(k) ? recurrenceMatch(bare, 1) : null
  }

  // ── single-word tokens ──

  const matchTag = (k: number): Match | null => {
    const w = wordAt(k)
    const m = w ? TAG_RE.exec(w.core) : null
    const name = m?.[1]
    if (!name || !/\p{L}/u.test(name)) return null
    const tag = canonicalTag.get(normalizeTag(name)) ?? name
    return { payload: { kind: 'tag', tag }, label: `#${tag}`, count: 1 }
  }

  const matchPriority = (k: number): Match | null => {
    if (taken.priority) return null
    const w = wordAt(k)
    if (!w || !w.lower.startsWith('!')) return null
    const priority = PRIORITY_WORDS.get(w.lower.slice(1))
    if (priority === undefined) return null
    const label = priority === 4 ? PRIORITY_LABELS[4] : `${PRIORITY_LABELS[priority]} priority`
    return { payload: { kind: 'priority', priority }, label, count: 1 }
  }

  const matchEstimate = (k: number): Match | null => {
    if (taken.estimate) return null
    const w = wordAt(k)
    const m = w ? /^~(\d{1,2})$/.exec(w.core) : null
    if (!m) return null
    const pomodoros = Number(m[1])
    if (pomodoros < 1) return null
    const unit = w?.trailing === '' ? wordAt(k + 1) : undefined
    if (unit && DURATION_UNITS.has(unit.lower)) return null // "~5 minutes" is not pomodoros
    const label = `${pomodoros} ${pomodoros === 1 ? 'pomodoro' : 'pomodoros'}`
    return { payload: { kind: 'estimate', pomodoros }, label, count: 1 }
  }

  // ── scan ──

  const commit = (match: Match, k: number): void => {
    let first = k
    const before = words[k - 1]
    if (k > 0 && before && !before.quoted && owner[k - 1] === -1 && before.trailing === '') {
      const kind = match.payload.kind
      const connectors =
        kind === 'date' ? DATE_CONNECTORS : kind === 'time' && !match.viaAt ? TIME_CONNECTORS : null
      if (connectors?.has(before.lower)) first = k - 1
    }
    const last = k + match.count - 1
    const lastWord = words[last] as Word
    const isLiteral = match.payload.kind === 'literal'
    const index = found.length
    found.push({
      payload: match.payload,
      label: match.label,
      start: (words[first] as Word).start,
      end: lastWord.end,
      dropEnd: isLiteral ? lastWord.end : lastWord.end + lastWord.trailing.length,
      firstWord: first,
      lastWord: last,
    })
    for (let i = first; i <= last; i++) owner[i] = index
    const p = match.payload
    if (p.kind === 'date') taken[p.deadline ? 'deadlineDate' : 'date'] = true
    else if (p.kind === 'time') taken[p.deadline ? 'deadlineTime' : 'time'] = true
    else if (p.kind !== 'tag' && p.kind !== 'literal') taken[p.kind] = true
  }

  const matchAny = (k: number): Match | null =>
    matchTag(k) ??
    matchPriority(k) ??
    matchEstimate(k) ??
    matchRecurrence(k) ??
    matchDate(k) ??
    matchTime(k)

  /** Whether the word at `i` would start a token (quoted literals always do). */
  const startsToken = (i: number): boolean => words[i]?.quoted === true || matchAny(i) !== null

  for (let k = 0; k < words.length;) {
    const word = words[k] as Word
    if (word.quoted) {
      commit({ payload: { kind: 'literal', text: word.inner }, label: word.inner, count: 1 }, k)
      k++
      continue
    }
    const match = matchAny(k)
    if (match) {
      commit(match, k)
      k += match.count
    } else {
      k++
    }
  }

  // ── result ──

  let dateToken: string | undefined
  let timeToken: HHmm | undefined
  let deadlineDateToken: ISODate | undefined
  let deadlineTimeToken: HHmm | undefined
  let priority: Priority | undefined
  let estimate: number | undefined
  let recurrence: RecurrenceRule | undefined
  const tags: string[] = []
  const seenTags = new Set<string>()
  for (const f of found) {
    const p = f.payload
    if (p.kind === 'date') {
      if (p.deadline) deadlineDateToken = p.date
      else dateToken = p.date
    } else if (p.kind === 'time') {
      if (p.deadline) deadlineTimeToken = p.time
      else timeToken = p.time
    } else if (p.kind === 'priority') priority = p.priority
    else if (p.kind === 'estimate') estimate = p.pomodoros
    else if (p.kind === 'recurrence') recurrence = p.rule
    else if (p.kind === 'tag' && !seenTags.has(normalizeTag(p.tag))) {
      seenTags.add(normalizeTag(p.tag))
      tags.push(p.tag)
    }
  }

  let courseCode: string | undefined
  const courses = new Map<string, string>()
  for (const code of ctx.knownCourseCodes ?? [])
    courses.set(normalizeTag(code), code.trim().replace(/^#+/, ''))
  for (const tag of tags) {
    const code = courses.get(normalizeTag(tag))
    if (code !== undefined) {
      courseCode = code
      break
    }
  }

  const date =
    dateToken ?? (recurrence ? firstOccurrence(recurrence, today) : timeToken ? today : undefined)
  const when =
    date === undefined ? undefined : timeToken === undefined ? { date } : { date, time: timeToken }
  const deadlineDate = deadlineDateToken ?? (deadlineTimeToken ? (date ?? today) : undefined)
  const deadline =
    deadlineDate === undefined
      ? undefined
      : deadlineTimeToken === undefined
        ? { date: deadlineDate }
        : { date: deadlineDate, time: deadlineTimeToken }

  // Title: everything outside the tokens; quoted literals keep their text without the quotes.
  let title = ''
  let cursor = 0
  for (const f of found) {
    title += input.slice(cursor, f.start)
    if (f.payload.kind === 'literal') title += f.payload.text
    cursor = f.dropEnd
  }
  title += input.slice(cursor)
  title = title.replace(/\s+/g, ' ').trim()
  if (found.length > 0) title = title.replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, '')

  const result: QuickAddResult = {
    title,
    tags,
    tokens: found.map((f) => ({
      kind:
        (f.payload.kind === 'date' || f.payload.kind === 'time') && f.payload.deadline
          ? ('deadline' as const)
          : f.payload.kind,
      start: f.start,
      end: f.end,
      text: input.slice(f.start, f.end),
      label: f.label,
    })),
  }
  if (when) result.when = when
  if (deadline) result.deadline = deadline
  if (priority !== undefined) result.priority = priority
  if (estimate !== undefined) result.estimate = estimate
  if (recurrence) result.recurrence = recurrence
  if (courseCode !== undefined) result.courseCode = courseCode
  return result
}

/** `2:00 PM` for minutes after midnight. */
function timeLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60)
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${pad2(minutes % 60)} ${hour < 12 ? 'AM' : 'PM'}`
}

// ─── Presentation helpers ───────────────────────────────────────────────────

/**
 * Where a new task shows up first, by the day it is planned for (the do date, else the deadline): Today
 * (today or earlier), Upcoming (later) or Inbox (no date).
 */
export type QuickAddDestination = 'today' | 'upcoming' | 'inbox'

export const QUICK_ADD_DESTINATION_LABELS: Record<QuickAddDestination, string> = {
  today: 'Today',
  upcoming: 'Upcoming',
  inbox: 'Inbox',
}

export function quickAddDestination(
  result: Pick<QuickAddResult, 'when' | 'deadline'>,
  today: ISODate,
): QuickAddDestination {
  const day = result.when?.date ?? result.deadline?.date
  if (day === undefined) return 'inbox'
  return day <= today ? 'today' : 'upcoming'
}

export interface InputSegment {
  text: string
  /** Set on the pieces that are a recognised token; plain text has no token. */
  token?: QuickAddToken
}

/**
 * Cuts `input` into runs at the token boundaries, so an overlay can highlight the recognised text
 * while the user types. Concatenating every `text` gives `input` back exactly. Tokens that overlap
 * or fall outside the input are ignored (the parser never produces them).
 */
export function splitByTokens(input: string, tokens: readonly QuickAddToken[]): InputSegment[] {
  const segments: InputSegment[] = []
  let cursor = 0
  for (const token of tokens) {
    if (token.start < cursor || token.end > input.length || token.end <= token.start) continue
    if (token.start > cursor) segments.push({ text: input.slice(cursor, token.start) })
    segments.push({ text: input.slice(token.start, token.end), token })
    cursor = token.end
  }
  if (cursor < input.length) segments.push({ text: input.slice(cursor) })
  return segments
}
