/**
 * Numbers and chart data for the Progress page (pure). Everything takes plain rows and an explicit
 * `today`; nothing reads the clock, Dexie or the DOM, so every function is easy to test.
 *
 * What counts: a *counted* focus session (`kind: 'focus'`, `status: 'completed'`, `counted`), and only
 * its `actualMinutes`. Breaks, running timers, thrown-away sessions and sessions under the 80 % rule
 * never count (DECISIONS: anti-cheat). A session belongs to the local day it started on
 * (`Session.day`), also when it runs past midnight; the hour histogram is the one place that looks
 * inside a session.
 *
 * Nothing here judges: a day with no minutes is a zero, never a miss.
 */
import type { ID, ISODate, Millis, Session, TagColor, Task } from '@/db/types'
import { addDays, dayOf, diffDays, eachDay, startOfWeekISO, type WeekStart } from './dates'

// ─── Inputs ─────────────────────────────────────────────────────────────────

/** The parts of a session the statistics read. */
export type StatSession = Pick<
  Session,
  | 'id'
  | 'kind'
  | 'status'
  | 'counted'
  | 'day'
  | 'startedAt'
  | 'endedAt'
  | 'actualMinutes'
  | 'pausedMs'
  | 'taskId'
  | 'goalId'
  | 'milestoneId'
>

/** The parts of a task the statistics read. */
export type StatTask = Pick<
  Task,
  'id' | 'status' | 'completedAt' | 'completedDay' | 'estimatePomodoros'
>

/** Inclusive days. */
export interface StatRange {
  from: ISODate
  to: ISODate
}

/** A goal or course as a chart row needs it. */
export interface NamedRef {
  id: ID
  title: string
  color: TagColor
}

/** Whether a session counts, and the minutes it is worth (0 when it does not). */
export function countedMinutes(s: StatSession): number {
  if (s.kind !== 'focus' || s.status !== 'completed' || !s.counted) return 0
  const minutes = s.actualMinutes ?? 0
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0
}

const inRange = (day: ISODate, range: StatRange): boolean => day >= range.from && day <= range.to

/** Trims float noise (`0.1 + 0.2`) without changing anything a person could see. */
const clean = (n: number): number => Math.round(n * 1000) / 1000

// ─── Focus minutes ──────────────────────────────────────────────────────────

/** Counted focus minutes per day, for the days in `range` (days with none are absent). */
export function focusMinutesMap(
  sessions: readonly StatSession[],
  range?: StatRange,
): Map<ISODate, number> {
  const map = new Map<ISODate, number>()
  for (const s of sessions) {
    const minutes = countedMinutes(s)
    if (minutes === 0 || (range && !inRange(s.day, range))) continue
    map.set(s.day, (map.get(s.day) ?? 0) + minutes)
  }
  for (const [day, minutes] of map) map.set(day, clean(minutes))
  return map
}

export interface DayMinutes {
  day: ISODate
  minutes: number
}

/** The last `days` days ending `today`, oldest first, zero-filled. */
export function focusMinutesByDay(
  sessions: readonly StatSession[],
  today: ISODate,
  days = 30,
): DayMinutes[] {
  const from = addDays(today, -(Math.max(1, days) - 1))
  const map = focusMinutesMap(sessions, { from, to: today })
  return eachDay(from, today).map((day) => ({ day, minutes: Math.round(map.get(day) ?? 0) }))
}

/** All counted minutes (lifetime hours on the Progress header). */
export function totalCountedMinutes(sessions: readonly StatSession[]): number {
  let total = 0
  for (const s of sessions) total += countedMinutes(s)
  return clean(total)
}

// ─── Tasks per week ─────────────────────────────────────────────────────────

/** The day a finished task is filed under: `completedDay`, else the day of `completedAt`. */
export function taskDoneDay(t: Pick<Task, 'completedDay' | 'completedAt'>): ISODate | null {
  if (t.completedDay) return t.completedDay
  return t.completedAt === null ? null : dayOf(t.completedAt)
}

export interface WeekCount {
  /** First day of the week (per `weekStartsOn`). */
  weekStart: ISODate
  count: number
}

/**
 * Finished tasks per week for the `weeks` weeks ending with the week of `today`, oldest first,
 * zero-filled. The last week is the current one, so it is usually still filling up.
 */
export function tasksCompletedByWeek(
  tasks: readonly StatTask[],
  today: ISODate,
  weeks: number,
  weekStartsOn: WeekStart,
): WeekCount[] {
  const n = Math.max(1, Math.floor(weeks))
  const last = startOfWeekISO(today, weekStartsOn)
  const first = addDays(last, -(n - 1) * 7)
  const counts = new Map<ISODate, number>()
  const out: WeekCount[] = []
  for (let i = 0; i < n; i++) {
    const weekStart = addDays(first, i * 7)
    counts.set(weekStart, 0)
    out.push({ weekStart, count: 0 })
  }
  for (const t of tasks) {
    if (t.status !== 'done') continue
    const day = taskDoneDay(t)
    if (day === null || day > today) continue
    const week = startOfWeekISO(day, weekStartsOn)
    const current = counts.get(week)
    if (current !== undefined) counts.set(week, current + 1)
  }
  return out.map((w) => ({ weekStart: w.weekStart, count: counts.get(w.weekStart) ?? 0 }))
}

// ─── Time per goal / course ─────────────────────────────────────────────────

export interface MinutesRow {
  /** `null` = "Other": no goal (or course), or one that no longer exists. */
  id: ID | null
  title: string
  color: TagColor
  minutes: number
}

const OTHER_TITLE = 'Other'

function groupMinutes(
  sessions: readonly StatSession[],
  refs: readonly NamedRef[],
  range: StatRange,
  pick: (s: StatSession) => ID | null,
): MinutesRow[] {
  const byId = new Map(refs.map((r) => [r.id, r]))
  const totals = new Map<ID | null, number>()
  for (const s of sessions) {
    const minutes = countedMinutes(s)
    if (minutes === 0 || !inRange(s.day, range)) continue
    const id = pick(s)
    const key = id !== null && byId.has(id) ? id : null
    totals.set(key, (totals.get(key) ?? 0) + minutes)
  }
  const rows: MinutesRow[] = []
  let other = 0
  for (const [id, minutes] of totals) {
    const rounded = Math.round(minutes)
    if (rounded <= 0) continue
    const ref = id === null ? undefined : byId.get(id)
    if (ref) rows.push({ id: ref.id, title: ref.title, color: ref.color, minutes: rounded })
    else other += rounded
  }
  rows.sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title))
  if (other > 0) rows.push({ id: null, title: OTHER_TITLE, color: 'gray', minutes: other })
  return rows
}

/** Minutes per goal in `range`, most time first; "Other" (no goal, or a deleted one) is always last. */
export function minutesByGoal(
  sessions: readonly StatSession[],
  goals: readonly NamedRef[],
  range: StatRange,
): MinutesRow[] {
  return groupMinutes(sessions, goals, range, (s) => s.goalId)
}

/** Minutes per course in `range`; a session has a course through `milestoneId`. Same rules as goals. */
export function minutesByCourse(
  sessions: readonly StatSession[],
  courses: readonly NamedRef[],
  range: StatRange,
): MinutesRow[] {
  return groupMinutes(sessions, courses, range, (s) => s.milestoneId)
}

// ─── Best time of day ───────────────────────────────────────────────────────

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000
/** A focus session never runs this long; it only guards the hour loop against a corrupt row. */
const MAX_SPAN_MS = 48 * HOUR_MS

/** The local clock hour (0–23) of an instant, and the ms until the next local hour begins. */
function hourAt(ms: Millis): { hour: number; untilNext: number } {
  const d = new Date(ms)
  // Local wall-clock ms since local midnight of the *same wall date*, via the offset at this instant.
  // Stepping by real elapsed ms keeps a repeated autumn hour and a missing spring hour correct.
  const offsetMs = d.getTimezoneOffset() * MINUTE_MS
  const localMs = ms - offsetMs
  const intoHour = ((localMs % HOUR_MS) + HOUR_MS) % HOUR_MS
  return { hour: d.getHours(), untilNext: HOUR_MS - intoHour }
}

/**
 * Focus minutes by local hour of the day (24 entries) for sessions that started in `range`. A session's
 * minutes are spread over the hours it was open, in proportion to the time in each, so a 9:45–10:15 run
 * of 30 minutes gives 15 to hour 9 and 15 to hour 10, and one of 3 hours touches four hours. The total
 * is always the session's counted minutes: with pauses the same share applies (the pauses are not
 * dated), and a stopwatch capped at 4 h is spread over the first 4 h it ran, not over the whole night.
 */
export function hourHistogram(sessions: readonly StatSession[], range: StatRange): number[] {
  const hist = new Array<number>(24).fill(0)
  const add = (hour: number, minutes: number): void => {
    hist[hour] = (hist[hour] ?? 0) + minutes
  }
  for (const s of sessions) {
    const minutes = countedMinutes(s)
    if (minutes === 0 || !inRange(s.day, range)) continue
    const activeMs = minutes * MINUTE_MS
    const wallMs = (s.endedAt ?? s.startedAt + activeMs) - s.startedAt
    // Whole milliseconds, so every step below is an integer and the loop always advances.
    const end = Math.round(
      s.startedAt + Math.min(Math.max(wallMs, 0), activeMs + Math.max(s.pausedMs, 0), MAX_SPAN_MS),
    )
    const spanMs = end - s.startedAt
    if (spanMs <= 0) {
      add(hourAt(s.startedAt).hour, minutes)
      continue
    }
    let cursor = s.startedAt
    while (cursor < end) {
      const { hour, untilNext } = hourAt(cursor)
      const piece = Math.min(untilNext, end - cursor)
      add(hour, minutes * (piece / spanMs))
      cursor += piece
    }
  }
  return hist.map(clean)
}

/** The busiest hour, the earliest one on a tie; `null` when there is no time at all. */
export function peakHour(hist: readonly number[]): number | null {
  let best = -1
  let bestValue = 0
  hist.forEach((value, hour) => {
    if (value > bestValue) {
      best = hour
      bestValue = value
    }
  })
  return best < 0 ? null : best
}

// ─── Estimate accuracy ──────────────────────────────────────────────────────

/** Minutes in one pomodoro, the unit of `estimatePomodoros`. */
export const POMODORO_MINUTES = 25

export interface AccuracyPoint {
  taskId: ID
  /** The estimate, in pomodoros. */
  planned: number
  /** Counted focus minutes on the task ÷ 25, in steps of 0.5 (never 0 once time is logged). */
  actual: number
}

export interface EstimateAccuracy {
  points: AccuracyPoint[]
  /** Points with actual within ±20 % of planned. */
  within: number
  /** `within ÷ points`, 0–1; `null` with no points. */
  share: number | null
  /** Mean of actual ÷ planned; `null` with no points. Above 1 means tasks took longer than planned. */
  meanRatio: number | null
}

/** Whether `actual` is within ±20 % of `planned` (both in pomodoros, multiples of 0.5). */
export function isWithin20(planned: number, actual: number): boolean {
  return Math.abs(actual - planned) <= planned * 0.2 + 1e-9
}

/**
 * Planned against actual pomodoros for finished tasks that have both an estimate and logged focus
 * time. `actual` is the task's counted minutes ÷ 25 rounded to the nearest half (and at least 0.5).
 * Points come out in the order the tasks were finished.
 */
export function estimateAccuracy(
  tasks: readonly StatTask[],
  sessions: readonly StatSession[],
): EstimateAccuracy {
  const minutesByTask = new Map<ID, number>()
  for (const s of sessions) {
    const minutes = countedMinutes(s)
    if (minutes > 0 && s.taskId !== null) {
      minutesByTask.set(s.taskId, (minutesByTask.get(s.taskId) ?? 0) + minutes)
    }
  }
  const points: AccuracyPoint[] = []
  const sorted = [...tasks].sort(
    (a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0) || a.id.localeCompare(b.id),
  )
  for (const t of sorted) {
    const minutes = minutesByTask.get(t.id)
    const planned = t.estimatePomodoros
    if (t.status !== 'done' || minutes === undefined || planned === null || !(planned > 0)) continue
    const actual = Math.max(0.5, Math.round((minutes / POMODORO_MINUTES) * 2) / 2)
    points.push({ taskId: t.id, planned, actual })
  }
  if (points.length === 0) return { points, within: 0, share: null, meanRatio: null }
  const within = points.filter((p) => isWithin20(p.planned, p.actual)).length
  const ratio = points.reduce((sum, p) => sum + p.actual / p.planned, 0) / points.length
  return { points, within, share: within / points.length, meanRatio: clean(ratio) }
}

// ─── Yearly heatmap ─────────────────────────────────────────────────────────

export type HeatLevel = 0 | 1 | 2 | 3 | 4

export interface YearHeatmapCell {
  day: ISODate
  minutes: number
  /** 0 = no focus; 1–4 = quartile of the days that had focus in this range (4 = most). */
  level: HeatLevel
  /** A streak freeze covered this day. */
  frozen: boolean
  /** After `today`; drawn empty and never selectable. */
  future: boolean
}

export interface YearHeatmapWeek {
  weekStart: ISODate
  /** Seven days, first day of the week first. */
  cells: YearHeatmapCell[]
}

export interface YearHeatmap {
  weeks: YearHeatmapWeek[]
  /** The most minutes on any one day in the range. */
  max: number
  totalMinutes: number
  /** Days with any focus. */
  activeDays: number
  /** First and last day shown (the last is the end of today's week, so it may be in the future). */
  from: ISODate
  to: ISODate
}

/**
 * The heatmap grid: `weeks` (default 53) whole weeks ending with the week that holds `today`, so the
 * last column is the current week and its unfinished days are `future`. Colour is focused minutes:
 * days that had any are split into four levels by rank *within the days shown*, so a light stretch
 * still shows its shape and one huge day cannot flatten the rest. A level is
 * `ceil(4 × days at most this long ÷ days with focus)`: ties share the higher level, and one active
 * day is level 4. `frozen` days come from the streak engine (`frozenDays`).
 */
export function yearHeatmap(
  minutesByDay: ReadonlyMap<ISODate, number>,
  frozenDays: ReadonlySet<ISODate>,
  today: ISODate,
  weekStartsOn: WeekStart,
  weeks = 53,
): YearHeatmap {
  const n = Math.max(1, Math.floor(weeks))
  const lastWeek = startOfWeekISO(today, weekStartsOn)
  const firstWeek = addDays(lastWeek, -(n - 1) * 7)
  const to = addDays(lastWeek, 6)

  const active: number[] = []
  for (let day = firstWeek; day <= today; day = addDays(day, 1)) {
    const minutes = minutesByDay.get(day) ?? 0
    if (minutes > 0) active.push(minutes)
  }
  active.sort((a, b) => a - b)
  const total = active.length
  const levelOf = (minutes: number): HeatLevel => {
    if (minutes <= 0 || total === 0) return 0
    // Days at most this long: the index just past the last equal value.
    let lo = 0
    let hi = total
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((active[mid] ?? 0) <= minutes) lo = mid + 1
      else hi = mid
    }
    return Math.min(4, Math.max(1, Math.ceil((4 * lo) / total))) as HeatLevel
  }

  const out: YearHeatmapWeek[] = []
  let totalMinutes = 0
  for (let w = 0; w < n; w++) {
    const weekStart = addDays(firstWeek, w * 7)
    const cells: YearHeatmapCell[] = []
    for (let d = 0; d < 7; d++) {
      const day = addDays(weekStart, d)
      const future = diffDays(day, today) > 0
      const raw = future ? 0 : (minutesByDay.get(day) ?? 0)
      const minutes = Math.round(raw)
      totalMinutes += minutes
      cells.push({
        day,
        minutes,
        level: levelOf(raw),
        frozen: !future && frozenDays.has(day),
        future,
      })
    }
    out.push({ weekStart, cells })
  }
  return {
    weeks: out,
    max: active[total - 1] === undefined ? 0 : Math.round(active[total - 1] ?? 0),
    totalMinutes,
    activeDays: total,
    from: firstWeek,
    to,
  }
}
