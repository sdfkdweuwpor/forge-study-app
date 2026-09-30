/**
 * The Board layout (pure): which tasks it shows, how its three columns (To do, Doing, Done) are
 * ordered, and the moves a drag makes on lists of ids on the way to a drop.
 *
 * A board shows a list's tasks whatever their status. The Done column keeps only the last
 * `DONE_WINDOW_DAYS` days of finished work (newest first); older ones are counted, not drawn. To do and
 * Doing follow the view's sort, and in the manual sort they follow `boardOrder`, which is the board's
 * own order and never disturbs the list's.
 */
import type { ID, ISODate, Task, TaskFilter, TaskSort } from '@/db/types'
import { diffDays } from './dates'
import { completedDayOf, type TaskListId } from './taskLists'
import { filterTasks, sortTasks, type QueryContext } from './taskQuery'
import { planDay } from './taskDates'

export type BoardColumnId = 'todo' | 'doing' | 'done'

export const BOARD_COLUMNS: ReadonlyArray<{ id: BoardColumnId; label: string }> = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'Doing' },
  { id: 'done', label: 'Done' },
]

export const BOARD_COLUMN_IDS: readonly BoardColumnId[] = ['todo', 'doing', 'done']

/** Finished work older than this many days is counted under Done, not shown. */
export const DONE_WINDOW_DAYS = 7

export function columnLabel(id: BoardColumnId): string {
  return BOARD_COLUMNS.find((c) => c.id === id)?.label ?? id
}

/** Droppable id of a column body (task ids never start with this). */
export const columnKey = (id: BoardColumnId): string => `column:${id}`

export function parseColumnKey(value: string): BoardColumnId | null {
  if (!value.startsWith('column:')) return null
  const id = value.slice('column:'.length)
  return BOARD_COLUMN_IDS.find((c) => c === id) ?? null
}

/**
 * Whether a task belongs to a list on the board and calendar, which show finished work too. Same rule
 * as the list itself, minus its status test: Inbox is your own tasks, Upcoming is planned after today.
 */
export function inLayoutList(task: Task, list: TaskListId, ctx: { today: ISODate }): boolean {
  switch (list) {
    case 'all':
      return true
    case 'inbox':
      return task.goalId === null && task.milestoneId === null
    case 'upcoming':
      return (planDay(task) ?? '') > ctx.today
    case 'completed':
      return task.status === 'done'
  }
}

/** True when a finished task was done in the last `DONE_WINDOW_DAYS` days. */
export function isRecentlyDone(task: Task, today: ISODate): boolean {
  const day = completedDayOf(task)
  return day === null || diffDays(today, day) < DONE_WINDOW_DAYS
}

function byBoardOrder(a: Task, b: Task): number {
  return (
    a.boardOrder - b.boardOrder ||
    a.createdAt - b.createdAt ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

export interface BoardView {
  filter: TaskFilter
  sort: TaskSort
}

export interface BoardModel {
  columns: Record<BoardColumnId, Task[]>
  /** Finished tasks older than the Done window (after filters). */
  olderDone: number
  /** Tasks in the list before any filter: 0 means "nothing here at all". */
  total: number
}

/** Whether cards can be dragged into a new order: the manual sort, in its own direction. */
export function boardReorderable(sort: TaskSort): boolean {
  return sort.key === 'manual' && sort.dir === 'asc'
}

export function buildBoard(
  tasks: readonly Task[],
  list: TaskListId,
  view: BoardView,
  ctx: QueryContext,
): BoardModel {
  const pool = tasks.filter((t) => inLayoutList(t, list, ctx))
  const filtered = filterTasks(pool, view.filter, ctx)
  const ordered =
    view.sort.key === 'manual'
      ? [...filtered].sort((a, b) =>
          view.sort.dir === 'desc' ? byBoardOrder(b, a) : byBoardOrder(a, b),
        )
      : sortTasks(filtered, view.sort)
  const columns: Record<BoardColumnId, Task[]> = { todo: [], doing: [], done: [] }
  let olderDone = 0
  for (const task of ordered) {
    if (task.status !== 'done') columns[task.status].push(task)
    else if (isRecentlyDone(task, ctx.today)) columns.done.push(task)
    else olderDone += 1
  }
  columns.done.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || (a.id < b.id ? -1 : 1))
  return { columns, olderDone, total: pool.length }
}

/** Card ids of every column, in display order (the keyboard's `j`/`k` order). */
export function boardOrderIds(model: BoardModel): ID[] {
  return BOARD_COLUMN_IDS.flatMap((c) => model.columns[c].map((t) => t.id))
}

// ─── Moves while dragging ───────────────────────────────────────────────────

export type BoardIds = Record<BoardColumnId, ID[]>

export function boardIds(model: BoardModel): BoardIds {
  return {
    todo: model.columns.todo.map((t) => t.id),
    doing: model.columns.doing.map((t) => t.id),
    done: model.columns.done.map((t) => t.id),
  }
}

export function sameBoardIds(a: BoardIds, b: BoardIds): boolean {
  return BOARD_COLUMN_IDS.every(
    (c) => a[c].length === b[c].length && a[c].every((id, i) => id === b[c][i]),
  )
}

/** The column a card is in, or the column a droppable column id names. */
export function findColumn(ids: BoardIds, id: string): BoardColumnId | null {
  const key = parseColumnKey(id)
  if (key) return key
  return BOARD_COLUMN_IDS.find((c) => ids[c].includes(id)) ?? null
}

function arrayMove<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  if (item !== undefined) next.splice(Math.max(0, Math.min(next.length, to)), 0, item)
  return next
}

/**
 * The card is dragged over `overId` (another card, or a column). When that is another column the card
 * leaves its own and is inserted next to `overId` (after it when `below`), or at the end of an empty
 * or hovered column. Within one column nothing moves yet: that waits for the drop.
 */
export function moveOver(ids: BoardIds, activeId: ID, overId: string, below: boolean): BoardIds {
  const from = findColumn(ids, activeId)
  const to = findColumn(ids, overId)
  if (from === null || to === null || from === to) return ids
  const target = ids[to]
  const overIndex = parseColumnKey(overId) ? -1 : target.indexOf(overId)
  const at = overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.length
  return {
    ...ids,
    [from]: ids[from].filter((id) => id !== activeId),
    [to]: [...target.slice(0, at), activeId, ...target.slice(at)],
  }
}

/** The drop: within one column the card takes the index of the card it was dropped on. */
export function dropOver(ids: BoardIds, activeId: ID, overId: string | null): BoardIds {
  if (overId === null) return ids
  const from = findColumn(ids, activeId)
  const to = findColumn(ids, overId)
  if (from === null || to === null || from !== to) return ids
  const column = ids[from]
  const fromIndex = column.indexOf(activeId)
  const toIndex = parseColumnKey(overId) ? column.length - 1 : column.indexOf(overId)
  if (fromIndex === toIndex || toIndex < 0) return ids
  return { ...ids, [from]: arrayMove(column, fromIndex, toIndex) }
}

export interface Placement {
  column: BoardColumnId
  index: number
  count: number
  /** The neighbours it sits between now, for the fractional order. */
  above: ID | null
  below: ID | null
}

export function placementOf(ids: BoardIds, id: ID): Placement | null {
  const column = findColumn(ids, id)
  if (column === null) return null
  const list = ids[column]
  const index = list.indexOf(id)
  if (index < 0) return null
  return {
    column,
    index,
    count: list.length,
    above: list[index - 1] ?? null,
    below: list[index + 1] ?? null,
  }
}

/** `id` moved to the end of the neighbouring column (`step` -1 = left, 1 = right), or `null` at an edge. */
export function moveByColumn(ids: BoardIds, id: ID, step: -1 | 1): BoardIds | null {
  const from = findColumn(ids, id)
  if (from === null) return null
  const at = BOARD_COLUMN_IDS.indexOf(from) + step
  const to = BOARD_COLUMN_IDS[at]
  if (to === undefined) return null
  return { ...ids, [from]: ids[from].filter((x) => x !== id), [to]: [...ids[to], id] }
}
