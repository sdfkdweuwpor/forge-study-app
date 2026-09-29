/**
 * Filter, sort and group tasks (pure). `TaskFilter`/`TaskSort` live in `db/types` because saved views
 * store them; this file gives them meaning. Time is injected as `today` (a local `ISODate`).
 *
 * Conventions: an empty array in a filter means "no restriction" (nothing ticked in the UI); tag
 * comparisons ignore case and a leading `#`; `null` due dates / estimates always sort last.
 */
import type {
  ID,
  ISODate,
  Priority,
  Task,
  TaskDueFilter,
  TaskFilter,
  TaskSort,
  TaskSortKey,
} from '@/db/types'
import { toPlainText } from './blocks'
import { addDays, endOfWeekISO, type WeekStart } from './dates'
import { normalizeTag } from './tagColor'

export const PRIORITY_LABELS: Readonly<Record<Priority, string>> = {
  0: 'None',
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Urgent',
}

export function priorityLabel(priority: Priority): string {
  return PRIORITY_LABELS[priority]
}

export interface QueryContext {
  /** The local calendar day "now" falls on. */
  today: ISODate
  /** Week boundary for "This week"; defaults to Monday. */
  weekStartsOn?: WeekStart
}

// ─── Filtering ──────────────────────────────────────────────────────────────

/**
 * Due-date filter semantics: `overdue` = past due and not done; `today`/`tomorrow` = exactly that day;
 * `week` = today through the end of the current week (overdue excluded); `upcoming` = after today;
 * `none` = no due date; `any` = no restriction.
 */
function dueMatcher(due: TaskDueFilter, ctx: QueryContext): (task: Task) => boolean {
  const { today } = ctx
  switch (due) {
    case 'any':
      return () => true
    case 'none':
      return (t) => t.dueDate === null
    case 'overdue':
      return (t) => t.dueDate !== null && t.dueDate < today && t.status !== 'done'
    case 'today':
      return (t) => t.dueDate === today
    case 'tomorrow': {
      const tomorrow = addDays(today, 1)
      return (t) => t.dueDate === tomorrow
    }
    case 'week': {
      const end = endOfWeekISO(today, ctx.weekStartsOn ?? 1)
      return (t) => t.dueDate !== null && t.dueDate >= today && t.dueDate <= end
    }
    case 'upcoming':
      return (t) => t.dueDate !== null && t.dueDate > today
  }
}

function searchText(task: Task): string {
  const parts = [task.title, task.tags.map((t) => `#${t}`).join(' ')]
  for (const sub of task.subtasks) parts.push(sub.title)
  if (task.notes.length > 0) parts.push(toPlainText(task.notes))
  return parts.join('\n').toLowerCase()
}

/** Compiles a filter once into a predicate (cheap to run over thousands of tasks). */
export function taskMatcher(filter: TaskFilter, ctx: QueryContext): (task: Task) => boolean {
  const checks: Array<(task: Task) => boolean> = []

  const status = filter.status
  if (status && status.length > 0) checks.push((t) => status.includes(t.status))

  const priority = filter.priority
  if (priority && priority.length > 0) checks.push((t) => priority.includes(t.priority))

  const source = filter.source
  if (source && source.length > 0) checks.push((t) => source.includes(t.source))

  const goalIds = filter.goalIds
  if (goalIds && goalIds.length > 0) {
    const set = new Set<ID>(goalIds)
    checks.push((t) => t.goalId !== null && set.has(t.goalId))
  }

  const milestoneIds = filter.milestoneIds
  if (milestoneIds && milestoneIds.length > 0) {
    const set = new Set<ID>(milestoneIds)
    checks.push((t) => t.milestoneId !== null && set.has(t.milestoneId))
  }

  const wanted = [...new Set((filter.tags ?? []).map(normalizeTag).filter((t) => t !== ''))]
  if (wanted.length > 0) {
    const all = filter.tagsMatchAll === true
    checks.push((t) => {
      const have = new Set(t.tags.map(normalizeTag))
      return all ? wanted.every((tag) => have.has(tag)) : wanted.some((tag) => have.has(tag))
    })
  }

  if (filter.due && filter.due !== 'any') checks.push(dueMatcher(filter.due, ctx))

  const words = (filter.text ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
  if (words.length > 0) {
    checks.push((t) => {
      const haystack = searchText(t)
      return words.every((w) => haystack.includes(w))
    })
  }

  if (checks.length === 0) return () => true
  return (task) => checks.every((check) => check(task))
}

export function filterTasks(tasks: readonly Task[], filter: TaskFilter, ctx: QueryContext): Task[] {
  const matches = taskMatcher(filter, ctx)
  return tasks.filter(matches)
}

// ─── Sorting ────────────────────────────────────────────────────────────────

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Pomodoros, or minutes ÷ 25 when only minutes are known; `null` when there is no estimate. */
function estimateOf(task: Task): number | null {
  if (task.estimatePomodoros !== null) return task.estimatePomodoros
  if (task.estimateMinutes !== null) return task.estimateMinutes / 25
  return null
}

function compareDue(a: Task, b: Task): number {
  // Earlier day first; within a day, all-day (no time) before timed, then by time.
  if (a.dueDate !== b.dueDate) {
    return a.dueDate === null ? 1 : b.dueDate === null ? -1 : a.dueDate < b.dueDate ? -1 : 1
  }
  if (a.dueTime === b.dueTime) return 0
  if (a.dueTime === null) return -1
  if (b.dueTime === null) return 1
  return a.dueTime < b.dueTime ? -1 : 1
}

function compareStable(a: Task, b: Task): number {
  return a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * A comparator for `sort`. `dir` flips the primary key only. Undated / unestimated tasks stay last in
 * both directions, and ties fall back to a fixed order (manual order, created, id) so results never
 * depend on input order. `priority asc` runs none → urgent; `desc` puts urgent first.
 */
export function taskComparator(sort: TaskSort): (a: Task, b: Task) => number {
  const m = sort.dir === 'desc' ? -1 : 1
  const key: TaskSortKey = sort.key
  return (a, b) => {
    let primary = 0
    switch (key) {
      case 'manual':
        primary = m * (a.order - b.order)
        break
      case 'due': {
        if (a.dueDate === null || b.dueDate === null) primary = compareDue(a, b)
        else primary = m * compareDue(a, b)
        if (primary === 0) primary = b.priority - a.priority
        break
      }
      case 'priority':
        primary = m * (a.priority - b.priority)
        if (primary === 0) primary = compareDue(a, b)
        break
      case 'created':
        primary = m * (a.createdAt - b.createdAt)
        break
      case 'updated':
        primary = m * (a.updatedAt - b.updatedAt)
        break
      case 'title':
        primary = m * collator.compare(a.title, b.title)
        break
      case 'estimate': {
        const ea = estimateOf(a)
        const eb = estimateOf(b)
        if (ea === null || eb === null) primary = ea === eb ? 0 : ea === null ? 1 : -1
        else primary = m * (ea - eb)
        break
      }
    }
    return primary || compareStable(a, b)
  }
}

/** A sorted copy (the input is not mutated). */
export function sortTasks(tasks: readonly Task[], sort: TaskSort): Task[] {
  return [...tasks].sort(taskComparator(sort))
}

// ─── Grouping ───────────────────────────────────────────────────────────────

export type DateBucketId = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none' | 'earlier'

export const DATE_BUCKETS: ReadonlyArray<{ id: DateBucketId; label: string }> = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'week', label: 'This week' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'No date' },
  // Finished tasks whose due date has passed: not "overdue", so they get their own quiet bucket.
  { id: 'earlier', label: 'Earlier' },
]

/**
 * Which date bucket a task belongs to. "This week" runs from the day after tomorrow to the end of the
 * current week (`weekStartsOn`); anything later is "Later". A done task with a past due date is
 * "Earlier", never "Overdue".
 */
export function dateBucketOf(task: Task, ctx: QueryContext): DateBucketId {
  const due = task.dueDate
  if (due === null) return 'none'
  const { today } = ctx
  if (due < today) return task.status === 'done' ? 'earlier' : 'overdue'
  if (due === today) return 'today'
  if (due === addDays(today, 1)) return 'tomorrow'
  if (due <= endOfWeekISO(today, ctx.weekStartsOn ?? 1)) return 'week'
  return 'later'
}

export interface TaskGroup {
  id: string
  label: string
  tasks: Task[]
}

/** A goal or course a task can be grouped under; the caller supplies the label ("C182 Intro to IT"). */
export interface ProjectRef {
  id: ID
  kind: 'goal' | 'milestone'
  label: string
}

export type TaskGroupBy = 'date' | 'project' | 'none'

export interface GroupContext extends QueryContext {
  /** Projects in display order; groups follow this order. Tasks matching none go to "No project". */
  projects?: readonly ProjectRef[]
}

function groupByDate(tasks: readonly Task[], ctx: QueryContext): TaskGroup[] {
  const buckets = new Map<DateBucketId, Task[]>()
  for (const task of tasks) {
    const id = dateBucketOf(task, ctx)
    const list = buckets.get(id)
    if (list) list.push(task)
    else buckets.set(id, [task])
  }
  return DATE_BUCKETS.flatMap(({ id, label }) => {
    const list = buckets.get(id)
    return list ? [{ id, label, tasks: list }] : []
  })
}

function groupByProject(tasks: readonly Task[], projects: readonly ProjectRef[]): TaskGroup[] {
  const milestones = new Map<ID, ProjectRef>()
  const goals = new Map<ID, ProjectRef>()
  for (const project of projects) {
    ;(project.kind === 'milestone' ? milestones : goals).set(project.id, project)
  }
  const groups = new Map<string, Task[]>()
  for (const task of tasks) {
    // A course wins over its goal; an unknown course falls back to the goal.
    const project =
      (task.milestoneId !== null ? milestones.get(task.milestoneId) : undefined) ??
      (task.goalId !== null ? goals.get(task.goalId) : undefined)
    const key = project ? `${project.kind}:${project.id}` : 'none'
    const list = groups.get(key)
    if (list) list.push(task)
    else groups.set(key, [task])
  }
  const out: TaskGroup[] = []
  for (const project of projects) {
    const key = `${project.kind}:${project.id}`
    const list = groups.get(key)
    if (list) out.push({ id: key, label: project.label, tasks: list })
  }
  const none = groups.get('none')
  if (none) out.push({ id: 'none', label: 'No project', tasks: none })
  return out
}

/**
 * Splits tasks into labelled groups, keeping the input order inside each group (sort first).
 * `date`: Overdue, Today, Tomorrow, This week, Later, No date (Earlier for finished past-due work);
 * `project`: by course, else by goal, in the order of `ctx.projects`, then "No project";
 * `none`: a single unlabelled group. Empty groups are omitted.
 */
export function groupTasks(
  tasks: readonly Task[],
  groupBy: TaskGroupBy,
  ctx: GroupContext,
): TaskGroup[] {
  if (groupBy === 'none')
    return tasks.length > 0 ? [{ id: 'all', label: '', tasks: [...tasks] }] : []
  if (groupBy === 'date') return groupByDate(tasks, ctx)
  return groupByProject(tasks, ctx.projects ?? [])
}

// ─── One-call pipeline ──────────────────────────────────────────────────────

export interface TaskQuery {
  filter?: TaskFilter
  /** Defaults to manual order. */
  sort?: TaskSort
  /** Defaults to `none`. */
  groupBy?: TaskGroupBy
}

export interface TaskQueryResult {
  /** Filtered and sorted, ungrouped. */
  tasks: Task[]
  groups: TaskGroup[]
}

/** Filter → sort → group, the way a list view or saved view applies them. */
export function queryTasks(
  tasks: readonly Task[],
  query: TaskQuery,
  ctx: GroupContext,
): TaskQueryResult {
  const filtered = query.filter ? filterTasks(tasks, query.filter, ctx) : [...tasks]
  const sorted = sortTasks(filtered, query.sort ?? { key: 'manual', dir: 'asc' })
  return { tasks: sorted, groups: groupTasks(sorted, query.groupBy ?? 'none', ctx) }
}
