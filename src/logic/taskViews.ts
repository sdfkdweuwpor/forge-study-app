/**
 * Layouts and saved views of the Tasks screen (pure): which layout a list is showing (List, Board or
 * Calendar), how a saved view travels in the address bar next to its edits, and small helpers to compare
 * and name views.
 *
 * Layout: `?layout=board|calendar` wins; without it the list's remembered layout applies (a device
 * preference per list), then List. The Completed list has only the list layout.
 *
 * Saved views run over all open tasks (the All list). Opening one shows its stored filter, sort, group
 * and layout. Editing the filter bar does not touch the stored view: the edited state travels in the
 * address bar (`mod=1` plus the usual view keys) until it is saved or reset.
 */
import type { SavedView, TaskFilter, TaskSort } from '@/db/types'
import { deepEqual } from './deepEqual'
import { viewFromQuery, viewToQuery, type TaskListView, type ViewQuery } from './taskListView'
import { isTaskListId, type TaskListId } from './taskLists'

export type TaskLayout = SavedView['layout']

export const TASK_LAYOUTS: ReadonlyArray<{ id: TaskLayout; label: string }> = [
  { id: 'list', label: 'List' },
  { id: 'board', label: 'Board' },
  { id: 'calendar', label: 'Calendar' },
]

export function isTaskLayout(value: unknown): value is TaskLayout {
  return value === 'list' || value === 'board' || value === 'calendar'
}

/** A layout name from the address bar, or `undefined` for anything else. */
export function layoutFromQuery(value: string | undefined): TaskLayout | undefined {
  return isTaskLayout(value) ? value : undefined
}

/** The Completed list is a history: it only has the list layout. */
export function layoutsFor(list: TaskListId): readonly TaskLayout[] {
  return list === 'completed' ? ['list'] : ['list', 'board', 'calendar']
}

// ─── The remembered layout of each list ─────────────────────────────────────

export type LayoutPrefs = Partial<Record<TaskListId, TaskLayout>>

/** Reads the device preference (JSON `{ "inbox": "board" }`); anything malformed is dropped. */
export function parseLayoutPrefs(raw: string | null): LayoutPrefs {
  if (raw === null) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const prefs: LayoutPrefs = {}
    for (const [key, layout] of Object.entries(value)) {
      if (isTaskListId(key) && isTaskLayout(layout)) prefs[key] = layout
    }
    return prefs
  } catch {
    // Older builds stored a bare layout name; it applies to no list in particular.
    return {}
  }
}

export function serializeLayoutPrefs(prefs: LayoutPrefs): string {
  return JSON.stringify(prefs)
}

/** The layout a list shows: the address bar, else the remembered one, else List. Never one the list lacks. */
export function resolveLayout(
  list: TaskListId,
  fromQuery: string | undefined,
  prefs: LayoutPrefs,
): TaskLayout {
  const allowed = layoutsFor(list)
  const wanted = layoutFromQuery(fromQuery) ?? prefs[list] ?? 'list'
  return allowed.includes(wanted) ? wanted : 'list'
}

// ─── Comparing views ────────────────────────────────────────────────────────

/** A filter with its no-op keys removed, so `{ priority: [] }` and `{}` compare equal. */
export function normalizeFilter(filter: TaskFilter): TaskFilter {
  const out: TaskFilter = {}
  if (filter.status?.length) out.status = [...filter.status].sort()
  if (filter.priority?.length) out.priority = [...filter.priority].sort((a, b) => a - b)
  if (filter.tags?.length) out.tags = [...filter.tags]
  if (filter.tagsMatchAll === true && out.tags) out.tagsMatchAll = true
  if (filter.goalIds?.length) out.goalIds = [...filter.goalIds]
  if (filter.milestoneIds?.length) out.milestoneIds = [...filter.milestoneIds]
  if (filter.source?.length) out.source = [...filter.source]
  if (filter.due && filter.due !== 'any') out.due = filter.due
  const text = filter.text?.trim()
  if (text) out.text = text
  return out
}

function normalizeSort(sort: TaskSort): TaskSort {
  // A manual order has no direction worth comparing.
  return sort.key === 'manual' ? { key: 'manual', dir: 'asc' } : { key: sort.key, dir: sort.dir }
}

/** Whether two views show the same thing (filters compared without their no-op keys). */
export function sameView(a: TaskListView, b: TaskListView): boolean {
  return (
    a.groupBy === b.groupBy &&
    deepEqual(normalizeSort(a.sort), normalizeSort(b.sort)) &&
    deepEqual(normalizeFilter(a.filter), normalizeFilter(b.filter))
  )
}

// ─── Saved views ────────────────────────────────────────────────────────────

/** The list a saved view runs over. */
export const SAVED_VIEW_LIST: TaskListId = 'all'

/** The view (without layout) a saved view stores. */
export function savedViewToView(
  saved: Pick<SavedView, 'filter' | 'sort' | 'groupBy'>,
): TaskListView {
  return { filter: normalizeFilter(saved.filter), sort: saved.sort, groupBy: saved.groupBy }
}

export interface SavedViewState {
  view: TaskListView
  layout: TaskLayout
  /** True when the address bar holds edits that differ from what is stored. */
  modified: boolean
}

/** What a saved view shows right now: its stored settings, or the edits in the address bar. */
export function savedViewState(
  saved: Pick<SavedView, 'filter' | 'sort' | 'groupBy' | 'layout'>,
  query: Readonly<ViewQuery>,
): SavedViewState {
  const stored = savedViewToView(saved)
  const edited = query.mod === '1'
  const view = edited ? viewFromQuery(SAVED_VIEW_LIST, query) : stored
  const layout = layoutFromQuery(query.layout) ?? saved.layout
  return { view, layout, modified: !sameView(view, stored) || layout !== saved.layout }
}

/**
 * The query patch that makes the address bar say `view` and `layout` for a saved view. Every key is
 * present (`undefined` removes it): edits are written in full behind `mod=1`, and a state equal to the
 * stored one writes nothing, so the address is clean again.
 */
export function savedViewQuery(
  saved: Pick<SavedView, 'filter' | 'sort' | 'groupBy' | 'layout'>,
  view: TaskListView,
  layout: TaskLayout,
): ViewQuery {
  const layoutPatch = layout === saved.layout ? undefined : layout
  if (sameView(view, savedViewToView(saved))) return { ...resetViewQuery(), layout: layoutPatch }
  return { ...viewToQuery(SAVED_VIEW_LIST, view), mod: '1', layout: layoutPatch }
}

/** Every view key set to `undefined`, for "Reset" and for leaving a saved view. */
export function resetViewQuery(): ViewQuery {
  const defaults: TaskListView = {
    groupBy: 'date',
    sort: { key: 'manual', dir: 'asc' },
    filter: {},
  }
  return { ...viewToQuery(SAVED_VIEW_LIST, defaults), mod: undefined, layout: undefined }
}

/**
 * What to store when the current list is saved as a view. Saved views run over All, so a list's own
 * rule is folded into the filter where the filter can say it: Upcoming becomes "due later than today".
 */
export function viewToSave(list: TaskListId, view: TaskListView): TaskListView {
  const filter = normalizeFilter(view.filter)
  if (list === 'upcoming' && filter.due === undefined) filter.due = 'upcoming'
  return { ...view, filter }
}

/** Completed is a history, not a set of open tasks, so it cannot be saved as a view. */
export function canSaveView(list: TaskListId): boolean {
  return list !== 'completed'
}

/**
 * What the save form says about scope: a saved view always runs over all open tasks, and the rule of
 * the list it was saved from is kept only where a filter can say it (Upcoming becomes "due later").
 */
export function saveViewNote(list: TaskListId): string {
  const base = 'Keeps this layout, sort and filters, and shows them over all your open tasks.'
  if (list === 'inbox') {
    return `${base} The Inbox’s own rule (tasks not tied to a goal) is not kept, so the view can show more than the Inbox does.`
  }
  if (list === 'upcoming') {
    return `${base} Upcoming is kept as a “due later than today” filter.`
  }
  return base
}

// ─── Naming ─────────────────────────────────────────────────────────────────

const DUE_NAMES: Record<string, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  tomorrow: 'Due tomorrow',
  week: 'This week',
  upcoming: 'Coming up',
  none: 'No date',
}

const PRIORITY_NAMES: Record<number, string> = {
  1: 'Low priority',
  2: 'Medium priority',
  3: 'High priority',
  4: 'Urgent',
}

/**
 * A starting name for a new view, read from its filter: "High priority · C779", "Overdue", "Doing".
 * Falls back to the sort or "My view" so the field is never empty.
 */
export function suggestViewName(
  view: TaskListView,
  courseLabels: Readonly<Record<string, string>> = {},
): string {
  const filter = normalizeFilter(view.filter)
  const parts: string[] = []
  if (filter.priority?.length) {
    const top = Math.max(...filter.priority)
    if (filter.priority.length >= 2 && filter.priority.every((p) => p >= 3))
      parts.push('High priority')
    else parts.push(PRIORITY_NAMES[top] ?? 'Priority')
  }
  if (filter.due) parts.push(DUE_NAMES[filter.due] ?? 'Dated')
  for (const id of filter.milestoneIds?.slice(0, 2) ?? []) {
    const label = courseLabels[id]
    if (label) parts.push(label)
  }
  for (const tag of filter.tags?.slice(0, 2) ?? []) parts.push(`#${tag.replace(/^#+/, '')}`)
  if (filter.status?.length === 1 && filter.status[0] === 'doing') parts.push('Doing')
  if (parts.length === 0) {
    return view.sort.key === 'due'
      ? 'By due date'
      : view.sort.key === 'priority'
        ? 'By priority'
        : 'My view'
  }
  return parts.slice(0, 3).join(' · ')
}
