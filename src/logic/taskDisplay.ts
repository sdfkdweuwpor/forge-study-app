/**
 * How a task is described in a row or a chip (pure): due dates in relative words, times of day,
 * estimates and checklist progress. `today` is always passed in.
 */
import { format } from 'date-fns'
import type { HHmm, ISODate, Subtask, Task } from '@/db/types'
import { diffDays, fromISODate, parseHHmm } from './dates'
import { WEEKDAY_NAMES } from './recurrence'

/** `'14:00'` → `2 PM`, `'14:30'` → `2:30 PM`, `'00:05'` → `12:05 AM`. Malformed input is returned as is. */
export function formatTimeOfDay(time: HHmm): string {
  const minutes = parseHHmm(time)
  if (minutes === null) return time
  const h24 = Math.floor(minutes / 60)
  const m = minutes % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const suffix = h24 < 12 ? 'AM' : 'PM'
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

/** "Sep 29", or "Sep 29, 2027" outside the current year. */
export function formatDay(day: ISODate, today: ISODate): string {
  const date = fromISODate(day)
  const sameYear = date.getFullYear() === fromISODate(today).getFullYear()
  return format(date, sameYear ? 'MMM d' : 'MMM d, yyyy')
}

/** "Tue, Sep 29" for headings and tooltips. */
export function formatDayLong(day: ISODate, today: ISODate): string {
  const date = fromISODate(day)
  const sameYear = date.getFullYear() === fromISODate(today).getFullYear()
  return format(date, sameYear ? 'EEE, MMM d' : 'EEE, MMM d, yyyy')
}

/**
 * A day in relative words: Yesterday, Today, Tomorrow, a weekday name for the next six days, and a
 * date for anything further away. Days before yesterday read "N days ago".
 */
export function relativeDay(day: ISODate, today: ISODate): string {
  const diff = diffDays(day, today)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0 && diff >= -13) return `${-diff} days ago`
  if (diff > 1 && diff <= 6) return WEEKDAY_NAMES[fromISODate(day).getDay()] ?? formatDay(day, today)
  return formatDay(day, today)
}

export type DueTone =
  /** Past due and still open. Drawn in amber. */
  | 'overdue'
  | 'today'
  | 'upcoming'
  /** A finished task's date: quiet. */
  | 'done'

export interface DueLabel {
  /** "Today, 2 PM", "3 days ago", "Fri". */
  text: string
  tone: DueTone
  /** Full text for tooltips and screen readers: "Overdue, due Fri, Sep 25". */
  description: string
}

/** The due chip of a task, or `null` when it has no due date. */
export function dueLabel(
  task: Pick<Task, 'dueDate' | 'dueTime' | 'status'>,
  today: ISODate,
): DueLabel | null {
  const { dueDate, dueTime, status } = task
  if (dueDate === null) return null
  const diff = diffDays(dueDate, today)
  const done = status === 'done'
  const tone: DueTone = done ? 'done' : diff < 0 ? 'overdue' : diff === 0 ? 'today' : 'upcoming'
  const day = relativeDay(dueDate, today)
  // A time of day only matters while the task can still be done on that day.
  const text = dueTime !== null && diff >= 0 ? `${day}, ${formatTimeOfDay(dueTime)}` : day
  const full = formatDayLong(dueDate, today) + (dueTime !== null ? `, ${formatTimeOfDay(dueTime)}` : '')
  const description =
    tone === 'overdue' ? `Overdue, due ${full}` : done ? `Was due ${full}` : `Due ${full}`
  return { text, tone, description }
}

export interface EstimateLabel {
  /** "~2" for pomodoros, "45m" for minutes only. */
  text: string
  /** "2 pomodoros, about 50 min". */
  description: string
}

/** The estimate chip: pomodoros first, minutes when that is all the task has. */
export function estimateLabel(
  task: Pick<Task, 'estimatePomodoros' | 'estimateMinutes'>,
): EstimateLabel | null {
  const { estimatePomodoros: pomodoros, estimateMinutes: minutes } = task
  if (pomodoros !== null && pomodoros > 0) {
    const noun = pomodoros === 1 ? 'pomodoro' : 'pomodoros'
    return { text: `~${pomodoros}`, description: `${pomodoros} ${noun}, about ${pomodoros * 25} min` }
  }
  if (minutes !== null && minutes > 0) {
    return { text: `${minutes}m`, description: `About ${minutes} min` }
  }
  return null
}

/** "2/5" for a checklist, or `null` when it is empty. */
export function subtaskProgress(
  subtasks: readonly Pick<Subtask, 'done'>[],
): { done: number; total: number; text: string } | null {
  if (subtasks.length === 0) return null
  const done = subtasks.filter((s) => s.done).length
  return { done, total: subtasks.length, text: `${done}/${subtasks.length}` }
}

/** "+15 XP" for a positive amount, "−15 XP" (a real minus) for a reversal. */
export function formatXp(amount: number): string {
  return amount < 0 ? `−${Math.abs(amount)} XP` : `+${amount} XP`
}
