/**
 * Daily rituals (BRIEF §5.11, Phase 11g), pure: the ids and keys the two rituals are stored under, the
 * rules of when Today offers them, what the morning plan lets you pick from and the evening shutdown
 * lets you move, and the small wording helpers. Nothing reads the clock, Dexie or the DOM.
 *
 * The rules of the words: a ritual is an invitation, never a duty. Skipping one has no cost, so nothing
 * here counts a missed one, and "done" is said plainly and quietly.
 *
 * "What is open today" is not derived again here: it is `groupToday` / `oneListToday` from `./today`
 * (what the Today screen shows), plus the carried-over group `groupToday` already computes.
 */
import type { HHmm, ID, ISODate, Ritual, Settings, Task } from '@/db/types'
import { isISODate, parseHHmm } from './dates'
import { planDay } from './taskDates'
import { relativeDay } from './taskDisplay'
import { oneListToday, type TodayContext, type TodayGroups } from './today'
import { XP_RITUAL } from './xp'

export type RitualKind = Ritual['kind']

export const RITUAL_KINDS: readonly RitualKind[] = ['morning', 'evening']

/** The morning plan picks at most this many tasks. */
export const TOP_MAX = 3

/** A reflection is one line, not a journal entry. */
export const REFLECTION_MAX = 280

/** Finishing the evening shutdown pays this once a day (BRIEF §5.11). */
export const XP_EVENING = XP_RITUAL

/** A ritual's row id: `morning:2026-09-29`. */
export const ritualId = (kind: RitualKind, day: ISODate): string => `${kind}:${day}`

/** The idempotency key of a day's evening XP. */
export const eveningXpKey = (day: ISODate): string => `ritual:evening:${day}`

// ─── Top 3 and reflection ───────────────────────────────────────────────────

/** Task ids for the top 3: blanks and repeats dropped, the order you picked kept, at most three. */
export function normalizeTop3(ids: readonly ID[]): ID[] {
  const seen = new Set<ID>()
  const out: ID[] = []
  for (const id of ids) {
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length === TOP_MAX) break
  }
  return out
}

/** One tidy line: whitespace collapsed, trimmed, cut at `REFLECTION_MAX` characters (never mid-emoji). */
export function cleanReflection(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= REFLECTION_MAX) return clean
  const chars = Array.from(clean)
  return chars.length <= REFLECTION_MAX ? clean : chars.slice(0, REFLECTION_MAX).join('').trimEnd()
}

/** How many of the top 3 are finished. A task that no longer exists is not counted at all. */
export function top3Progress(tasks: readonly (Pick<Task, 'status'> | undefined)[]): {
  done: number
  total: number
} {
  const present = tasks.filter((t): t is Pick<Task, 'status'> => t !== undefined)
  return { done: present.filter((t) => t.status === 'done').length, total: present.length }
}

// ─── What is on today's list ────────────────────────────────────────────────

/** A task on today's list, with the day it came from when it was carried over. */
export interface TodayItem {
  task: Task
  /** `null` for work planned for today; the earlier day for a carried-over task. */
  carriedFrom: ISODate | null
}

/**
 * Open work on Today, in the order the screen shows it: today's own list (plan sessions and everyday
 * tasks, timed ones first), then what was carried over from earlier days. Both rituals read this, so
 * the morning plan picks from, and the evening shutdown moves, exactly what Today shows.
 */
export function openTodayItems(groups: TodayGroups, ctx: TodayContext): TodayItem[] {
  return [
    ...oneListToday(groups, ctx).map((task) => ({ task, carriedFrom: null })),
    ...groups.carriedOver.map(({ task, from }) => ({ task, carriedFrom: from })),
  ]
}

/** Whether an open task is already planned for a later day (moved on, or in progress and dated ahead). */
export function isPlannedLater(task: Pick<Task, 'doDate' | 'dueDate'>, today: ISODate): boolean {
  const day = planDay(task)
  return day !== null && day > today
}

/** The ids the evening's one click moves: open items not already planned later and not set aside. */
export function movableIds(
  items: readonly TodayItem[],
  today: ISODate,
  left: ReadonlySet<ID>,
): ID[] {
  return items
    .filter(
      ({ task }) => task.status !== 'done' && !isPlannedLater(task, today) && !left.has(task.id),
    )
    .map(({ task }) => task.id)
}

// ─── When Today offers a ritual ─────────────────────────────────────────────

export const RITUAL_DEFAULT_TIMES = { morningUntil: '12:00', eveningFrom: '17:00' } as const

export interface PromptTimes {
  morningUntil: HHmm
  eveningFrom: HHmm
}

/** The two times from settings; a missing or malformed one falls back to its default. */
export function promptTimes(rituals: Partial<Settings['rituals']> | undefined): PromptTimes {
  const valid = (value: string | undefined, fallback: HHmm): HHmm =>
    value !== undefined && parseHHmm(value) !== null ? value : fallback
  return {
    morningUntil: valid(rituals?.morningUntil, RITUAL_DEFAULT_TIMES.morningUntil),
    eveningFrom: valid(rituals?.eveningFrom, RITUAL_DEFAULT_TIMES.eveningFrom),
  }
}

export interface PromptInput {
  /** Minutes after local midnight, now. */
  minutes: number
  times: PromptTimes
  /** `settings.rituals.prompts`. */
  enabled: boolean
  morningDone: boolean
  eveningDone: boolean
  /** Prompts put away for today. */
  dismissed: readonly RitualKind[]
}

/**
 * Which ritual Today should invite you to right now, if any: the morning plan before `morningUntil`
 * while it is not done, the evening shutdown from `eveningFrom` while it is not done, and nothing in
 * between, once it is done, once you have put it away for the day, or when prompts are off. If the two
 * windows overlap (a morning time later than the evening time) the evening wins.
 */
export function ritualPrompt(input: PromptInput): RitualKind | null {
  if (!input.enabled) return null
  const morningUntil = parseHHmm(input.times.morningUntil) ?? 0
  const eveningFrom = parseHHmm(input.times.eveningFrom) ?? 24 * 60
  if (input.minutes >= eveningFrom && !input.eveningDone && !input.dismissed.includes('evening')) {
    return 'evening'
  }
  if (input.minutes < morningUntil && !input.morningDone && !input.dismissed.includes('morning')) {
    return 'morning'
  }
  return null
}

// ─── Putting a prompt away for the day ──────────────────────────────────────

interface DismissedRecord {
  day: ISODate
  kinds: RitualKind[]
}

function parseDismissed(raw: string | null): DismissedRecord | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { day, kinds } = value as { day?: unknown; kinds?: unknown }
    if (!isISODate(day) || !Array.isArray(kinds)) return null
    return {
      day,
      kinds: kinds.filter((k): k is RitualKind => k === 'morning' || k === 'evening'),
    }
  } catch {
    return null
  }
}

/** The prompts put away for `today` (what was stored for another day is forgotten). */
export function dismissedKinds(raw: string | null, today: ISODate): RitualKind[] {
  const record = parseDismissed(raw)
  return record !== null && record.day === today ? record.kinds : []
}

/** The stored form after also putting `kind` away for `today`. */
export function withDismissed(raw: string | null, today: ISODate, kind: RitualKind): string {
  const kinds = dismissedKinds(raw, today)
  const next: DismissedRecord = {
    day: today,
    kinds: kinds.includes(kind) ? kinds : [...kinds, kind],
  }
  return JSON.stringify(next)
}

// ─── Words ──────────────────────────────────────────────────────────────────

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The evening's first line: what got done, said quietly. A day with nothing done is not a bad day. */
export function doneHeadline(done: number): string {
  if (done === 0) return 'Nothing checked off today, and that is fine.'
  return `You finished ${plural(done, 'task')} today.`
}

/** The evening's second line, about what is still open. */
export function openHeadline(open: number): string {
  if (open === 0) return 'Nothing is waiting. Tomorrow starts clear.'
  return `${plural(open, 'task')} still open. Nothing is lost by moving ${open === 1 ? 'it' : 'them'} on.`
}

/**
 * A day inside a sentence: "today", "tomorrow", "yesterday" in lower case, and a weekday or a date as
 * written ("Friday", "Oct 12"), so "Moved to Friday" and "Moved to tomorrow" both read naturally.
 */
export function dayWords(day: ISODate, today: ISODate): string {
  const words = relativeDay(day, today)
  return words === 'Today' || words === 'Tomorrow' || words === 'Yesterday'
    ? words.toLowerCase()
    : words
}

/** "Move 4 to tomorrow" for the one-click button. */
export function moveLabel(count: number): string {
  return `Move ${count} to tomorrow`
}

// ─── Reflections ────────────────────────────────────────────────────────────

/** The newest reflections first: evening rows with some words, at most `limit`. */
export function recentReflections(rows: readonly Ritual[], limit = 30): Ritual[] {
  return rows
    .filter((r) => r.kind === 'evening' && r.reflection.trim() !== '')
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .slice(0, limit)
}
