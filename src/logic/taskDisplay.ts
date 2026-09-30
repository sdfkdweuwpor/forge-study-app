/**
 * How a task is described in a row or a chip (pure): the day it is planned for and its deadline in
 * relative words, times of day, estimates and checklist progress. `today` is always passed in.
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
  if (diff > 1 && diff <= 6)
    return WEEKDAY_NAMES[fromISODate(day).getDay()] ?? formatDay(day, today)
  return formatDay(day, today)
}

/** The tone of a date chip. Nothing here is ever red: dates inform, they do not scold. */
export type DueTone =
  /** Planned for an earlier day and still open: quiet, it just carried over. */
  | 'carried'
  | 'today'
  | 'upcoming'
  /** A finished task's date: quiet. */
  | 'done'

export interface DueLabel {
  /** "Today, 2 PM", "3 days ago", "Fri". */
  text: string
  tone: DueTone
  /** Full text for tooltips and screen readers: "Planned for Fri, Sep 25". */
  description: string
}

/**
 * The "when" chip of a task: its do date and time, or `null` when it has no do date (a task with only a
 * deadline shows just its deadline chip).
 */
export function dueLabel(
  task: Pick<Task, 'doDate' | 'doTime' | 'status'>,
  today: ISODate,
): DueLabel | null {
  const { doDate, doTime, status } = task
  if (doDate === null) return null
  const diff = diffDays(doDate, today)
  const done = status === 'done'
  const tone: DueTone = done ? 'done' : diff < 0 ? 'carried' : diff === 0 ? 'today' : 'upcoming'
  const day = relativeDay(doDate, today)
  // A time of day only matters while the task can still be done on that day.
  const text = doTime !== null && diff >= 0 ? `${day}, ${formatTimeOfDay(doTime)}` : day
  const full =
    formatDayLong(doDate, today) + (doTime !== null ? `, ${formatTimeOfDay(doTime)}` : '')
  const description =
    tone === 'carried'
      ? `Carried over from ${full}`
      : done
        ? `Was planned for ${full}`
        : `Planned for ${full}`
  return { text, tone, description }
}

export type DeadlineTone =
  /** Due today and still open: the one amber moment. */
  | 'dueToday'
  /** Any other day, and a passed deadline too: calm. */
  | 'calm'

export interface DeadlineLabel {
  /** "Due Fri", "Due today, 5 PM", "Due Sep 30"; once passed, "Was due Tue". */
  text: string
  tone: DeadlineTone
  /** "Due Fri, Oct 2, 5 PM". */
  description: string
}

/**
 * The small deadline chip ("Due Fri"), or `null` when the task has no deadline or is finished. Amber
 * only on the due day; a deadline that has passed reads a neutral "Was due Tue", never red.
 */
export function deadlineLabel(
  task: Pick<Task, 'dueDate' | 'dueTime' | 'status'>,
  today: ISODate,
): DeadlineLabel | null {
  const { dueDate, dueTime, status } = task
  if (dueDate === null || status === 'done') return null
  const diff = diffDays(dueDate, today)
  const weekday = WEEKDAY_NAMES[fromISODate(dueDate).getDay()]?.slice(0, 3)
  const day =
    diff === 0
      ? 'today'
      : diff === 1
        ? 'tomorrow'
        : diff === -1
          ? 'yesterday'
          : (diff > 1 && diff <= 6) || (diff < -1 && diff >= -6)
            ? (weekday ?? formatDay(dueDate, today))
            : formatDay(dueDate, today)
  const time = dueTime !== null && diff >= 0 ? `, ${formatTimeOfDay(dueTime)}` : ''
  const full =
    formatDayLong(dueDate, today) + (dueTime !== null ? `, ${formatTimeOfDay(dueTime)}` : '')
  return {
    text: `${diff < 0 ? 'Was due' : 'Due'} ${day}${time}`,
    tone: diff === 0 ? 'dueToday' : 'calm',
    description: `${diff < 0 ? 'Was due' : 'Due'} ${full}`,
  }
}

export interface EstimateLabel {
  /** "~2" for pomodoros, "45m" for minutes only. */
  text: string
  /** "2 pomodoros, about 50 min". */
  description: string
}

/** The estimate chip: pomodoros first, minutes when that is all the task has. */
export function estimateLabel(
  task: Pick<Task, 'estimatePomodoros' | 'estimateMinutes'> & Partial<Pick<Task, 'durationMinutes'>>,
): EstimateLabel | null {
  const { estimatePomodoros: pomodoros } = task
  const minutes = task.estimateMinutes ?? task.durationMinutes ?? null
  if (pomodoros !== null && pomodoros > 0) {
    const noun = pomodoros === 1 ? 'pomodoro' : 'pomodoros'
    return {
      text: `~${pomodoros}`,
      description: `${pomodoros} ${noun}, about ${pomodoros * 25} min`,
    }
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
