/**
 * What happens to a task around completion (pure): the date of the next recurring instance and the row
 * that instance is made from. The repo does the writes; the rules live here so they can be tested
 * without a database.
 */
import type { ID, ISODate, Millis, RecurrenceRule, Task } from '@/db/types'
import { addDays, diffDays } from './dates'
import { nextOccurrence } from './recurrence'

/** Safety net for a task that has been overdue for years; each step is one occurrence. */
const MAX_CATCH_UP_STEPS = 800

/**
 * The do date of the instance that follows one completed (or skipped) on `today`. It is the first
 * occurrence strictly after both the finished instance's do date and today, so a daily task finished
 * three days late is next planned for tomorrow (not in the past), while the weekly/interval phase of the
 * series is kept. A task with no date recurs from today.
 */
export function nextDateAfterCompletion(
  rule: RecurrenceRule,
  doDate: ISODate | null,
  today: ISODate,
): ISODate {
  let next = nextOccurrence(rule, doDate ?? today)
  for (let i = 0; i < MAX_CATCH_UP_STEPS && next <= today; i++) next = nextOccurrence(rule, next)
  return next <= today ? nextOccurrence(rule, today) : next
}

/**
 * The deadline that goes with a task moved from `fromDo` to `toDo`: it keeps its distance from the do
 * date (a bill planned two days before it is due stays two days ahead). `null` without a deadline; a
 * deadline without a do date moves with the recurrence by the same rule.
 */
export function shiftedDeadline(
  task: Pick<Task, 'doDate' | 'dueDate'>,
  toDo: ISODate,
): ISODate | null {
  if (task.dueDate === null) return null
  if (task.doDate === null) return toDo
  return addDays(toDo, diffDays(task.dueDate, task.doDate))
}

export interface NextInstanceOptions {
  id: ID
  /** The new instance's do date; its deadline (if any) keeps its distance from it. */
  doDate: ISODate
  now: Millis
  /** Ids for the fresh (unchecked) copies of the checklist. */
  newId: () => ID
}

/**
 * The next instance of a recurring task: the same title, notes, priority, estimate, tags, links, time
 * and rule, on its next do date (a deadline moves along with it), with the checklist unchecked and the
 * completion fields cleared. It joins the finished
 * instance's series (`seriesId`, or the finished task's id when it started the series).
 */
export function buildNextInstance(task: Task, opts: NextInstanceOptions): Task {
  return {
    ...task,
    id: opts.id,
    createdAt: opts.now,
    updatedAt: opts.now,
    status: 'todo',
    doDate: opts.doDate,
    dueDate: shiftedDeadline(task, opts.doDate),
    notes: task.notes.map((block) => ({
      ...block,
      ...(block.type === 'todo' ? { checked: false } : {}),
    })),
    subtasks: task.subtasks.map((sub) => ({ ...sub, id: opts.newId(), done: false })),
    tags: [...task.tags],
    recurrence: task.recurrence
      ? { ...task.recurrence, byWeekday: [...task.recurrence.byWeekday] }
      : null,
    seriesId: task.seriesId ?? task.id,
    scheduleKey: null,
    schedulePinned: false,
    skippedOn: null,
    sync: null,
    startedAt: null,
    completedAt: null,
    completedDay: null,
  }
}
