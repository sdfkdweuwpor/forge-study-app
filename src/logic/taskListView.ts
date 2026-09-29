/**
 * A list's view settings (grouping, sort, filters) as they travel in the address bar, so a filtered
 * list survives a reload and can be shared or bookmarked (pure). Only what differs from a list's
 * defaults is written; anything unknown or malformed in a hand-edited URL is ignored.
 *
 * Keys: `group=date|project|none`, `sort=<key>`, `dir=asc|desc`, `status=todo,doing`, `priority=3,4`,
 * `tag=C779,mentor`, `course=<milestoneId>,…`, `due=overdue|today|tomorrow|week|upcoming|none`.
 */
import type {
  Priority,
  TaskDueFilter,
  TaskFilter,
  TaskSort,
  TaskSortKey,
  TaskStatus,
} from '@/db/types'
import { defaultGroupBy, defaultSort, type TaskListId } from './taskLists'
import type { TaskGroupBy } from './taskQuery'

export interface TaskListView {
  groupBy: TaskGroupBy
  sort: TaskSort
  filter: TaskFilter
}

export type ViewQuery = Record<string, string | undefined>

const GROUPS: readonly TaskGroupBy[] = ['date', 'project', 'none']
export const SORT_KEYS: readonly TaskSortKey[] = [
  'manual',
  'due',
  'priority',
  'created',
  'updated',
  'title',
  'estimate',
]
const DUE_FILTERS: readonly TaskDueFilter[] = [
  'overdue',
  'today',
  'tomorrow',
  'week',
  'upcoming',
  'none',
]
const STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'done']

const csv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value)
}

/** Reads a list's view from its query string, falling back to the list's defaults. */
export function viewFromQuery(list: TaskListId, query: Readonly<ViewQuery>): TaskListView {
  const fallbackSort = defaultSort(list)
  const key = pick(query.sort, SORT_KEYS) ?? fallbackSort.key
  // A direction on its own means nothing; it applies to whichever key is in effect.
  const dir = pick(query.dir, ['asc', 'desc'] as const) ?? (key === fallbackSort.key ? fallbackSort.dir : 'asc')

  const filter: TaskFilter = {}
  const status = csv(query.status).flatMap((s) => STATUSES.filter((known) => known === s))
  if (status.length > 0) filter.status = [...new Set(status)]
  const priority = csv(query.priority)
    .map(Number)
    .filter((n): n is Priority => Number.isInteger(n) && n >= 0 && n <= 4)
  if (priority.length > 0) filter.priority = [...new Set(priority)]
  const tags = csv(query.tag)
  if (tags.length > 0) filter.tags = tags
  const courses = csv(query.course)
  if (courses.length > 0) filter.milestoneIds = courses
  const due = pick(query.due, DUE_FILTERS)
  if (due) filter.due = due

  return {
    groupBy: pick(query.group, GROUPS) ?? defaultGroupBy(list),
    sort: { key, dir },
    filter,
  }
}

/**
 * The query-string patch that makes the address bar say `view`. Every key is present, `undefined`
 * for defaults, so `setQuery(patch)` removes stale values.
 */
export function viewToQuery(list: TaskListId, view: TaskListView): ViewQuery {
  const fallbackSort = defaultSort(list)
  const sortChanged = view.sort.key !== fallbackSort.key
  const dirChanged = view.sort.dir !== (sortChanged ? 'asc' : fallbackSort.dir)
  const { filter } = view
  return {
    group: view.groupBy === defaultGroupBy(list) ? undefined : view.groupBy,
    sort: sortChanged ? view.sort.key : undefined,
    dir: dirChanged ? view.sort.dir : undefined,
    status: filter.status?.length ? filter.status.join(',') : undefined,
    priority: filter.priority?.length ? filter.priority.join(',') : undefined,
    tag: filter.tags?.length ? filter.tags.join(',') : undefined,
    course: filter.milestoneIds?.length ? filter.milestoneIds.join(',') : undefined,
    due: filter.due && filter.due !== 'any' ? filter.due : undefined,
  }
}

/** How many filters are active (each kind counts once), for the "Filter · 2" badge. */
export function activeFilterCount(filter: TaskFilter): number {
  let n = 0
  if (filter.status?.length) n++
  if (filter.priority?.length) n++
  if (filter.tags?.length) n++
  if (filter.milestoneIds?.length) n++
  if (filter.due && filter.due !== 'any') n++
  return n
}

/** Removes every filter, keeping grouping and sort. */
export function clearFilters(view: TaskListView): TaskListView {
  return { ...view, filter: {} }
}

/** True when nothing differs from the list's defaults (no "Reset view" needed). */
export function isDefaultView(list: TaskListId, view: TaskListView): boolean {
  const q = viewToQuery(list, view)
  return Object.values(q).every((v) => v === undefined)
}

/** Whether rows of this view can be dragged into a new order (only in manual sort, one list). */
export function canReorder(list: TaskListId, view: TaskListView): boolean {
  return list !== 'completed' && view.sort.key === 'manual' && view.sort.dir === 'asc'
}
