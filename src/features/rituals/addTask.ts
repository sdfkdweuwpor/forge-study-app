import type { TaskInput } from '@/db/repos/tasks'
import type { ISODate, Millis } from '@/db/types'
import { parseQuickAdd } from '@/logic/quickAdd'

export interface TodayTaskDraft {
  input: TaskInput
  /** The day the task is planned for (today unless the words named another day). */
  day: ISODate
}

/**
 * The task for a line typed into the morning plan's "Add a task": the same words as Quick add (`2p`, `30m`,
 * `!high`, `#C182`, `tomorrow`), planned for today unless the line names a day. `null` for a blank line.
 * A line that is only tokens ("tomorrow") keeps the words as its title rather than making a nameless task.
 */
export function todayTaskDraft(
  text: string,
  ctx: { now: Millis; today: ISODate; weekStartsOn: 0 | 1 },
): TodayTaskDraft | null {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line === '') return null
  const parsed = parseQuickAdd(line, { now: ctx.now, weekStartsOn: ctx.weekStartsOn })
  const day = parsed.when?.date ?? ctx.today
  return {
    day,
    input: {
      title: parsed.title === '' ? line : parsed.title,
      doDate: day,
      priority: parsed.priority ?? 0,
      tags: parsed.tags,
      ...(parsed.when?.time ? { doTime: parsed.when.time } : {}),
      ...(parsed.deadline ? { dueDate: parsed.deadline.date } : {}),
      ...(parsed.deadline?.time ? { dueTime: parsed.deadline.time } : {}),
      ...(parsed.durationMinutes !== undefined ? { durationMinutes: parsed.durationMinutes } : {}),
      ...(parsed.estimate !== undefined ? { estimatePomodoros: parsed.estimate } : {}),
      ...(parsed.recurrence ? { recurrence: parsed.recurrence } : {}),
    },
  }
}
