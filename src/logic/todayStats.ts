/**
 * The numbers on the Today screen that are not the task list itself (pure): the greeting, the daily
 * goal, the current streak, the 14-day mini heatmap and the milestone countdown. `today` is always
 * passed in; nothing here reads the clock.
 *
 * Phase 4 fills `sessions` and Phase 7 fills `streakDays`; until then these read whatever exists
 * (no sessions means 0 pomodoros, no streak rows means a streak of 0, and the heatmap falls back to
 * finished tasks). The functions take plain rows so those phases can feed them better data.
 */
import type { Goal, ID, ISODate, Milestone, Session, StreakDay } from '@/db/types'
import { format } from 'date-fns'
import { addDays, diffDays, fromISODate } from './dates'

// ─── Greeting ───────────────────────────────────────────────────────────────

export type DayPart = 'morning' | 'afternoon' | 'evening'

/** Morning until noon, afternoon until 6 PM, evening after. `hour` is the local hour, 0–23. */
export function dayPart(hour: number): DayPart {
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

/** "Good morning" or "Good morning, Sam" (a blank name is ignored). */
export function greeting(hour: number, name = ''): string {
  const who = name.trim()
  return `Good ${dayPart(hour)}${who ? `, ${who}` : ''}`
}

// ─── Daily goal ─────────────────────────────────────────────────────────────

/** The parts of a session the daily goal reads. */
export type GoalSession = Pick<
  Session,
  'kind' | 'mode' | 'status' | 'counted' | 'actualMinutes' | 'day'
>

/**
 * Pomodoros finished on `today`. A counted pomodoro session is one; a counted custom or stopwatch
 * session is worth as many whole pomodoros as its focused minutes fill. Breaks, running, abandoned
 * and uncounted sessions (under the 80 % rule) do not count.
 */
export function pomodorosDone(
  sessions: readonly GoalSession[],
  today: ISODate,
  pomodoroMinutes: number,
): number {
  const size = Math.max(1, pomodoroMinutes)
  let total = 0
  for (const s of sessions) {
    if (s.kind !== 'focus' || s.status !== 'completed' || !s.counted || s.day !== today) continue
    total += s.mode === 'pomodoro' ? 1 : Math.floor((s.actualMinutes ?? 0) / size)
  }
  return total
}

// ─── Streak ─────────────────────────────────────────────────────────────────

/**
 * Consecutive qualifying days ending today, or ending yesterday while today is still open (a streak
 * is not lost until the day is over). Streak freezes are Phase 7's: a frozen day is not counted here.
 */
export function currentStreak(
  days: readonly Pick<StreakDay, 'day' | 'qualified'>[],
  today: ISODate,
): number {
  const qualified = new Set<ISODate>()
  for (const d of days) if (d.qualified) qualified.add(d.day)
  let cursor = qualified.has(today) ? today : addDays(today, -1)
  let count = 0
  while (qualified.has(cursor)) {
    count += 1
    cursor = addDays(cursor, -1)
  }
  return count
}

// ─── Heatmap ────────────────────────────────────────────────────────────────

export type HeatLevel = 0 | 1 | 2 | 3 | 4

export interface HeatmapDay {
  day: ISODate
  /** Focused minutes that day (0 when there are no sessions). */
  minutes: number
  /** Tasks finished that day. */
  tasks: number
  level: HeatLevel
}

export interface Heatmap {
  /** Oldest first; the last entry is `today`. */
  days: HeatmapDay[]
  /** What the shade means: focused minutes, or (until there are sessions) tasks finished. */
  basis: 'focus' | 'tasks'
}

/** Shade for a day of focus: none, under a pomodoro, a pomodoro or more, an hour or more, two hours. */
export function levelForMinutes(minutes: number): HeatLevel {
  if (minutes <= 0) return 0
  if (minutes < 25) return 1
  if (minutes < 60) return 2
  if (minutes < 120) return 3
  return 4
}

/** Shade for a day of finished tasks: 0, 1, 2, 3, 4 or more. */
export function levelForTasks(tasks: number): HeatLevel {
  if (tasks <= 0) return 0
  return Math.min(4, Math.floor(tasks)) as HeatLevel
}

export interface HeatmapInput {
  today: ISODate
  /** Number of days shown, ending today. Default 14. */
  length?: number
  /** Focused minutes by day. */
  focusMinutes: ReadonlyMap<ISODate, number>
  /** Finished tasks by day. */
  tasksDone: ReadonlyMap<ISODate, number>
}

/**
 * The last `length` days with a shade for each. When any of those days has focus minutes, the shade is
 * focus time; otherwise it is the number of finished tasks, so the map is alive before the timer exists.
 */
export function buildHeatmap({
  today,
  length = 14,
  focusMinutes,
  tasksDone,
}: HeatmapInput): Heatmap {
  const start = addDays(today, -(length - 1))
  const days: HeatmapDay[] = []
  for (let i = 0; i < length; i++) {
    const day = addDays(start, i)
    days.push({
      day,
      minutes: Math.max(0, Math.round(focusMinutes.get(day) ?? 0)),
      tasks: Math.max(0, tasksDone.get(day) ?? 0),
      level: 0,
    })
  }
  const basis = days.some((d) => d.minutes > 0) ? 'focus' : 'tasks'
  return {
    basis,
    days: days.map((d) => ({
      ...d,
      level: basis === 'focus' ? levelForMinutes(d.minutes) : levelForTasks(d.tasks),
    })),
  }
}

// ─── Milestone countdown ────────────────────────────────────────────────────

export interface Countdown {
  id: ID
  kind: 'course' | 'milestone' | 'goal'
  goalId: ID
  /** "C779", or null for a milestone or goal without a code. */
  code: string | null
  title: string
  /** The target day. */
  date: ISODate
  /** Whole days from `today` to `date`; negative once it is past and still not done. */
  days: number
}

type TargetGoal = Pick<Goal, 'id' | 'title' | 'status' | 'targetDate'>
type TargetMilestone = Pick<
  Milestone,
  'id' | 'goalId' | 'kind' | 'code' | 'title' | 'status' | 'dueDate'
>

/**
 * The next target dates: unfinished courses and milestones with a due date, and active goals with a
 * target date. Earliest first, and a course before its goal on the same day. A target that has passed
 * without being finished stays in the list (with negative `days`), because it is the most urgent.
 */
export function upcomingTargets(
  goals: readonly TargetGoal[],
  milestones: readonly TargetMilestone[],
  today: ISODate,
  limit = 3,
): Countdown[] {
  const found: Countdown[] = []
  for (const m of milestones) {
    if (m.status === 'done' || m.dueDate === null) continue
    found.push({
      id: m.id,
      kind: m.kind,
      goalId: m.goalId,
      code: m.code,
      title: m.title,
      date: m.dueDate,
      days: diffDays(m.dueDate, today),
    })
  }
  for (const g of goals) {
    if (g.status !== 'active' || g.targetDate === null) continue
    found.push({
      id: g.id,
      kind: 'goal',
      goalId: g.id,
      code: null,
      title: g.title,
      date: g.targetDate,
      days: diffDays(g.targetDate, today),
    })
  }
  const rank = (c: Countdown): number => (c.kind === 'goal' ? 1 : 0)
  found.sort(
    (a, b) => a.days - b.days || rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  return found.slice(0, Math.max(0, limit))
}

/** "12 days", "1 day", "Today", "3 days overdue". */
export function countdownText(days: number): string {
  if (days === 0) return 'Today'
  const n = Math.abs(days)
  const unit = n === 1 ? 'day' : 'days'
  return days > 0 ? `${n} ${unit}` : `${n} ${unit} overdue`
}

/**
 * What a carried-over row shows in place of its date: the day it came from, never how late it is
 * (no guilt). "from Tue" within the last week, else "from Sep 20" (with the year when it differs).
 */
export function carriedFromText(from: ISODate, today: ISODate): string {
  const days = diffDays(today, from)
  const date = fromISODate(from)
  if (days >= 1 && days < 7) return `from ${format(date, 'EEE')}`
  const sameYear = date.getFullYear() === fromISODate(today).getFullYear()
  return `from ${format(date, sameYear ? 'MMM d' : 'MMM d, yyyy')}`
}

/**
 * How long a task should take, in words for the Now card: minutes when the task has them ("45 min",
 * "1 h 30 min"), otherwise pomodoros ("2 pomodoros"), otherwise `null`.
 */
export function estimateText(task: {
  estimateMinutes: number | null
  estimatePomodoros: number | null
}): string | null {
  const { estimateMinutes: minutes, estimatePomodoros: pomodoros } = task
  if (minutes !== null && minutes > 0) {
    const h = Math.floor(minutes / 60)
    const m = Math.round(minutes % 60)
    if (h === 0) return `${m} min`
    return m === 0 ? `${h} h` : `${h} h ${m} min`
  }
  if (pomodoros !== null && pomodoros > 0)
    return `${pomodoros} ${pomodoros === 1 ? 'pomodoro' : 'pomodoros'}`
  return null
}
