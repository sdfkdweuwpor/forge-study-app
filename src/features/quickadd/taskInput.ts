import type { TaskInput } from '@/db/repos/tasks'
import type { QuickAddResult } from '@/logic/quickAdd'
import type { QuickAddCourse } from './queries'

/** The repo input for a parsed quick add: only what was typed is set, the repo fills the rest. */
export function toTaskInput(result: QuickAddResult, course: QuickAddCourse | undefined): TaskInput {
  return {
    title: result.title,
    priority: result.priority ?? 0,
    tags: result.tags,
    ...(result.when ? { doDate: result.when.date } : {}),
    ...(result.when?.time ? { doTime: result.when.time } : {}),
    ...(result.deadline ? { dueDate: result.deadline.date } : {}),
    ...(result.deadline?.time ? { dueTime: result.deadline.time } : {}),
    ...(result.estimate !== undefined ? { estimatePomodoros: result.estimate } : {}),
    ...(result.recurrence ? { recurrence: result.recurrence } : {}),
    ...(course ? { milestoneId: course.id, goalId: course.goalId } : {}),
  }
}
