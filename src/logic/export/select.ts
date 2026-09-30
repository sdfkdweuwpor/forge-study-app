/**
 * Shared task selection for the CSV and Markdown exports: scope (open / completed / all), an optional
 * date range on the day a task is planned for, and one stable order.
 */
import type { Goal, ID, ISODate, Milestone, Task } from '@/db/types'
import { planDay } from '@/logic/taskDates'

export type TaskScope = 'open' | 'completed' | 'all'

export interface TaskSelection {
  /** Default `all`. `open` = todo and doing. */
  scope?: TaskScope
  /** Inclusive. A task counts by its do date, else its deadline, else (when finished) its completed day. */
  from?: ISODate | null
  to?: ISODate | null
}

/** What the exports look up: goal and course names for the "goal" and "course code" columns. */
export interface ExportLookups {
  goals: readonly Pick<Goal, 'id' | 'title'>[]
  milestones: readonly Pick<Milestone, 'id' | 'code' | 'title'>[]
}

/** The day a task belongs to for filtering and grouping (`null` = no date). */
export function taskDay(task: Task): ISODate | null {
  return planDay(task) ?? (task.status === 'done' ? task.completedDay : null)
}

export function selectTasks(tasks: readonly Task[], sel: TaskSelection = {}): Task[] {
  const scope = sel.scope ?? 'all'
  const from = sel.from ?? null
  const to = sel.to ?? null
  const out = tasks.filter((t) => {
    if (scope === 'open' && t.status === 'done') return false
    if (scope === 'completed' && t.status !== 'done') return false
    if (from !== null || to !== null) {
      const day = taskDay(t)
      if (day === null) return false
      if (from !== null && day < from) return false
      if (to !== null && day > to) return false
    }
    return true
  })
  return out.sort(compareTasks)
}

const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0)

/** Date, then time, then the manual order, then the title and id, so output never depends on input order. */
export function compareTasks(a: Task, b: Task): number {
  const da = taskDay(a)
  const db = taskDay(b)
  if (da !== db) {
    if (da === null) return 1
    if (db === null) return -1
    return cmp(da, db)
  }
  return (
    cmp(a.doTime ?? '~', b.doTime ?? '~') ||
    cmp(a.order, b.order) ||
    cmp(a.title, b.title) ||
    cmp(a.id, b.id)
  )
}

export interface Names {
  goalTitle(id: ID | null): string
  courseCode(id: ID | null): string
}

export function makeNames(ctx: ExportLookups): Names {
  const goals = new Map(ctx.goals.map((g) => [g.id, g.title]))
  const courses = new Map(ctx.milestones.map((m) => [m.id, m.code ?? '']))
  return {
    goalTitle: (id) => (id === null ? '' : (goals.get(id) ?? '')),
    courseCode: (id) => (id === null ? '' : (courses.get(id) ?? '')),
  }
}
