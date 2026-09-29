/**
 * The Tasks screen's lists (pure): which tasks belong in Inbox, Upcoming, All and Completed, how each
 * list is sorted and grouped by default, and how finished work is grouped by the day it was done.
 * Filtering, sorting and date/project grouping of the open lists lives in `taskQuery`.
 */
import type { ISODate, Task, TaskSort } from '@/db/types'
import { dayOf, addDays, diffDays, fromISODate } from './dates'
import { format } from 'date-fns'
import type { TaskGroup, TaskGroupBy } from './taskQuery'

export type TaskListId = 'inbox' | 'upcoming' | 'all' | 'completed'

export const TASK_LISTS: ReadonlyArray<{ id: TaskListId; label: string }> = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'all', label: 'All tasks' },
  { id: 'completed', label: 'Completed' },
]

export function isTaskListId(value: unknown): value is TaskListId {
  return value === 'inbox' || value === 'upcoming' || value === 'all' || value === 'completed'
}

/** The route's optional `:list` segment; anything unknown falls back to Inbox. */
export function listFromParam(param: string | undefined): TaskListId {
  return isTaskListId(param) ? param : 'inbox'
}

export function listLabel(list: TaskListId): string {
  return TASK_LISTS.find((l) => l.id === list)?.label ?? 'Tasks'
}

/**
 * List membership.
 *  - inbox: open tasks that are not tied to a goal or course (your own tasks, whatever their date);
 *  - upcoming: open tasks due after today;
 *  - all: every open task;
 *  - completed: every finished task.
 */
export function inList(task: Task, list: TaskListId, ctx: { today: ISODate }): boolean {
  const done = task.status === 'done'
  switch (list) {
    case 'completed':
      return done
    case 'all':
      return !done
    case 'upcoming':
      return !done && task.dueDate !== null && task.dueDate > ctx.today
    case 'inbox':
      return !done && task.goalId === null && task.milestoneId === null
  }
}

/** How a list groups by default. Completed groups by the day the work was finished. */
export function defaultGroupBy(list: TaskListId): TaskGroupBy {
  return list === 'completed' ? 'none' : 'date'
}

/** Manual order, except Upcoming (soonest first) and Completed (latest first). */
export function defaultSort(list: TaskListId): TaskSort {
  if (list === 'upcoming') return { key: 'due', dir: 'asc' }
  return { key: 'manual', dir: 'asc' }
}

/** The day a finished task was completed, falling back to the day of `completedAt`. */
export function completedDayOf(task: Task): ISODate | null {
  if (task.completedDay !== null) return task.completedDay
  return task.completedAt !== null ? dayOf(task.completedAt) : null
}

/** "Today", "Yesterday", "Fri, Sep 25", or "Fri, Sep 25, 2026" outside the current year. */
export function completedDayLabel(day: ISODate, today: ISODate): string {
  const diff = diffDays(today, day)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const date = fromISODate(day)
  const sameYear = date.getFullYear() === fromISODate(today).getFullYear()
  return format(date, sameYear ? 'EEE, MMM d' : 'EEE, MMM d, yyyy')
}

/** Finished tasks by completion day, newest day first and newest task first inside a day. */
export function groupCompleted(tasks: readonly Task[], ctx: { today: ISODate }): TaskGroup[] {
  const byDay = new Map<ISODate, Task[]>()
  for (const task of tasks) {
    // Nothing records when a "done" task was finished: file it under today's tail rather than losing it.
    const day = completedDayOf(task) ?? ctx.today
    const list = byDay.get(day)
    if (list) list.push(task)
    else byDay.set(day, [task])
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, list]) => ({
      id: `day:${day}`,
      label: completedDayLabel(day, ctx.today),
      tasks: [...list].sort(
        (a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || (a.id < b.id ? -1 : 1),
      ),
    }))
}

/** Tomorrow's date, for the "due tomorrow" shortcut. */
export function tomorrowOf(today: ISODate): ISODate {
  return addDays(today, 1)
}
