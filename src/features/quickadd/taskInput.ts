import type { TaskInput } from '@/db/repos/tasks'
import type { QuickAddResult } from '@/logic/quickAdd'
import type { QuickAddCourse } from './queries'

/** The repo input for a parsed quick add: only what was typed is set, the repo fills the rest. */
export function toTaskInput(result: QuickAddResult, course: QuickAddCourse | undefined): TaskInput {
  return {
    title: result.title,
    priority: result.priority ?? 0,
    tags: result.tags,
    ...(result.due ? { dueDate: result.due.date } : {}),
    ...(result.due?.time ? { dueTime: result.due.time } : {}),
    ...(result.estimate !== undefined ? { estimatePomodoros: result.estimate } : {}),
    ...(result.recurrence ? { recurrence: result.recurrence } : {}),
    ...(course ? { milestoneId: course.id, goalId: course.goalId } : {}),
  }
}
