/**
 * The two dates of a task (schema v2, pure):
 * - `doDate`/`doTime`: when I plan to do it. Today, the lists, the board and the calendar read it.
 * - `dueDate`/`dueTime`: a hard deadline, only when there is one. It is shown as a calm "Due Fri" chip
 *   (amber on the day itself, never red) and never moves a task between lists by itself.
 *
 * A task with a deadline but no do date is planned for its deadline (`planDay`), so "Pay the phone bill,
 * due Fri" shows up on Friday even if nobody picked a day for it.
 */
import type { HHmm, ISODate, Task, TaskKind, TaskSource } from '@/db/types'

/** The v2 task fields and their values for a plain, unplanned task. */
export const TASK_V2_DEFAULTS = {
  doDate: null,
  doTime: null,
  durationMinutes: null,
  autoSlot: false,
  kind: 'task',
  assessmentId: null,
  sync: null,
} as const satisfies Pick<
  Task,
  'doDate' | 'doTime' | 'durationMinutes' | 'autoSlot' | 'kind' | 'assessmentId' | 'sync'
>

/** The kind a task gets from its source when nobody says otherwise. */
export function kindForSource(source: TaskSource): TaskKind {
  return source === 'schedule' ? 'study' : source === 'flashcards' ? 'review' : 'task'
}

/** The day a task is planned for: its do date, else its deadline, else none. */
export function planDay(task: Pick<Task, 'doDate' | 'dueDate'>): ISODate | null {
  return task.doDate ?? task.dueDate
}

/** Its planned start: the do time, which only counts together with a do date. */
export function planTime(task: Pick<Task, 'doDate' | 'doTime'>): HHmm | null {
  return task.doDate === null ? null : task.doTime
}
