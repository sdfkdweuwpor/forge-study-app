/**
 * Task writes (PLAN §1.2). Components never touch `db.tasks`; they call these. Multi-table changes run
 * in one transaction, domain events are emitted inside it (so they fire only after the commit), and
 * reversible actions return an `undo()` a toast can hold.
 *
 * XP: `completeTask` appends the award in the same transaction as the status change, and
 * `uncompleteTask` appends its negative. `updateTask` cannot change `status`: use `setTaskStatus`.
 */
import { newId } from '@/lib/ids'
import { dayOf } from '@/logic/dates'
import { deepEqual } from '@/logic/deepEqual'
import { evenOrders, isCrowded, orderBetween } from '@/logic/order'
import { firstOccurrence } from '@/logic/recurrence'
import { buildNextInstance, nextDueAfterCompletion } from '@/logic/taskFlow'
import { cleanTags } from '@/logic/tagColor'
import { xpForTask } from '@/logic/xp'
import { db } from '../db'
import { emit } from '../events'
import type { Block, HHmm, ID, ISODate, Millis, Subtask, Task, TaskStatus } from '../types'
import { awardXp, reverseXp } from './xp'
import { moveToTrash, type TrashResult } from './trash'

export interface RepoOptions {
  /** Injected clock for tests; defaults to `Date.now()`. */
  now?: Millis
}

export interface Undoable {
  undo: () => Promise<void>
}

const noop = async (): Promise<void> => undefined

// ─── Create ─────────────────────────────────────────────────────────────────

/** Everything a new task can carry; only the title is required. */
export type TaskInput = Partial<Omit<Task, 'createdAt' | 'updatedAt'>> & { title: string }

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim()
}

/**
 * Creates a task at the end of the list. A recurring task with no date is anchored to the first day
 * its rule allows, on or after today. Does not award XP; finishing a task does (`completeTask`).
 */
export async function createTask(input: TaskInput, opts: RepoOptions = {}): Promise<Task> {
  const now = opts.now ?? Date.now()
  const title = cleanTitle(input.title)
  if (title === '') throw new RangeError('A task needs a title')

  const recurrence = input.recurrence ?? null
  const dueDate = input.dueDate ?? (recurrence ? firstOccurrence(recurrence, dayOf(now)) : null)
  const status = input.status ?? 'todo'
  // Time-based order keeps appends O(1): no scan for the largest existing value.
  const order = input.order ?? now

  const task: Task = {
    id: input.id ?? newId(),
    createdAt: now,
    updatedAt: now,
    title,
    notes: input.notes ?? [],
    status,
    priority: input.priority ?? 0,
    dueDate,
    dueTime: input.dueTime ?? null,
    estimatePomodoros: input.estimatePomodoros ?? null,
    estimateMinutes: input.estimateMinutes ?? null,
    tags: cleanTags(input.tags ?? []),
    goalId: input.goalId ?? null,
    milestoneId: input.milestoneId ?? null,
    unitId: input.unitId ?? null,
    source: input.source ?? 'user',
    scheduleKey: input.scheduleKey ?? null,
    schedulePinned: input.schedulePinned ?? false,
    skippedOn: input.skippedOn ?? null,
    orderInDay: input.orderInDay ?? 0,
    subtasks: input.subtasks ?? [],
    recurrence,
    seriesId: input.seriesId ?? null,
    order,
    boardOrder: input.boardOrder ?? order,
    startedAt: input.startedAt ?? (status === 'doing' ? now : null),
    completedAt: input.completedAt ?? (status === 'done' ? now : null),
    completedDay: input.completedDay ?? (status === 'done' ? dayOf(now) : null),
  }

  return db.transaction('rw', db.tasks, async () => {
    await db.tasks.add(task)
    emit({ type: 'task.created', taskId: task.id })
    return task
  })
}

// ─── Update ─────────────────────────────────────────────────────────────────

/** The fields `updateTask` may change. Status and completion go through their own functions. */
export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'notes'
    | 'priority'
    | 'dueDate'
    | 'dueTime'
    | 'estimatePomodoros'
    | 'estimateMinutes'
    | 'tags'
    | 'goalId'
    | 'milestoneId'
    | 'unitId'
    | 'subtasks'
    | 'recurrence'
    | 'schedulePinned'
    | 'skippedOn'
    | 'order'
    | 'orderInDay'
    | 'boardOrder'
  >
>

export interface TaskUpdate extends Undoable {
  task: Task
}

type Mutable = Record<string, unknown>

/** The stored form of a patch: trimmed title, clean tags, and the rules that follow from other fields. */
function settle(before: Task, patch: TaskPatch, now: Millis): Partial<Task> {
  const next: Partial<Task> = { ...patch }
  if ('title' in patch) {
    const title = cleanTitle(patch.title ?? '')
    if (title === '') delete next.title
    else next.title = title
  }
  if (patch.tags) next.tags = cleanTags(patch.tags)

  // A recurring task with no date is anchored to its rule.
  const recurrence = 'recurrence' in patch ? patch.recurrence : before.recurrence
  const dueDate = 'dueDate' in patch ? patch.dueDate : before.dueDate
  if (recurrence && (dueDate === null || dueDate === undefined)) {
    next.dueDate = firstOccurrence(recurrence, dayOf(now))
  }
  return next
}

/** Only the keys whose value really changes, with the values they had. */
function diff(
  before: Task,
  next: Partial<Task>,
): { changes: Partial<Task>; previous: Partial<Task> } {
  const changes: Mutable = {}
  const previous: Mutable = {}
  for (const key of Object.keys(next) as (keyof Task)[]) {
    const value = next[key]
    if (value === undefined || deepEqual(before[key], value)) continue
    changes[key] = value
    previous[key] = before[key]
  }
  return { changes: changes as Partial<Task>, previous: previous as Partial<Task> }
}

/** Writes `changes` to a stored task and emits `task.changed`. Must run inside a `tasks` transaction. */
async function writeChanges(id: ID, changes: Partial<Task>): Promise<Task> {
  await db.tasks.update(id, changes)
  emit({ type: 'task.changed', taskId: id })
  const after = await db.tasks.get(id)
  if (!after) throw new Error('Task disappeared during update')
  return after
}

/** Restores earlier field values (the undo of an edit). Leaves the task alone if it is gone. */
function restoreFields(id: ID, previous: Partial<Task>): () => Promise<void> {
  return async () => {
    await db.transaction('rw', db.tasks, async () => {
      if (await db.tasks.get(id)) await writeChanges(id, previous)
    })
  }
}

/**
 * Edits fields in place. Returns the saved task and an `undo()` that puts the changed fields back, or
 * `null` when the task no longer exists. A patch that changes nothing writes nothing. Editing the date
 * or time of a scheduled task pins it, so a rebalance leaves it where you put it.
 */
export async function updateTask(
  id: ID,
  patch: TaskPatch,
  opts: RepoOptions = {},
): Promise<TaskUpdate | null> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.tasks, async () => {
    const before = await db.tasks.get(id)
    if (!before) return null
    const { changes, previous } = diff(before, settle(before, patch, now))
    if (Object.keys(changes).length === 0) return { task: before, undo: noop }
    if (
      before.source === 'schedule' &&
      !('schedulePinned' in patch) &&
      ('dueDate' in changes || 'dueTime' in changes)
    ) {
      changes.schedulePinned = true
      previous.schedulePinned = before.schedulePinned
    }
    const task = await writeChanges(id, changes)
    return { task, undo: restoreFields(id, previous) }
  })
}

/**
 * Sets todo, doing or done. Done and back go through `completeTask` / `uncompleteTask`, so XP and
 * recurrence stay consistent; todo ⇄ doing only stamps `startedAt`. Returns `null` for a missing task.
 */
export async function setTaskStatus(
  id: ID,
  status: TaskStatus,
  opts: RepoOptions = {},
): Promise<Undoable | null> {
  const now = opts.now ?? Date.now()
  const before = await db.tasks.get(id)
  if (!before) return null
  if (status === before.status) return { undo: noop }

  if (status === 'done') {
    const result = await completeTask(id, opts)
    return { undo: result.undo }
  }

  const write = (changes: Partial<Task>) =>
    db.transaction('rw', db.tasks, async () => {
      if (await db.tasks.get(id)) await writeChanges(id, changes)
    })

  if (before.status === 'done') {
    await uncompleteTask(id, opts)
    if (status === 'doing') await write({ status: 'doing', startedAt: now })
    return { undo: async () => void (await completeTask(id)) }
  }

  await write({ status, startedAt: status === 'doing' ? now : null })
  return { undo: () => write({ status: before.status, startedAt: before.startedAt }) }
}

// ─── Complete / uncomplete / skip ───────────────────────────────────────────

export interface CompleteResult extends Undoable {
  /** XP awarded by this call (0 when the task was already done, missing, or had already paid out). */
  xp: number
  /** The task after completion, or `null` if it does not exist. */
  task: Task | null
  /** The next instance, when the task recurs. */
  next: Task | null
}

/**
 * Marks a task done, awards `xpForTask` (idempotent per task), and, if it recurs, creates the next
 * instance, all in one transaction. Emits `task.completed`. `undo()` reopens the task, removes the
 * instance it created and appends the negative XP event, so the net XP is zero.
 */
export async function completeTask(id: ID, opts: RepoOptions = {}): Promise<CompleteResult> {
  const now = opts.now ?? Date.now()
  const day = dayOf(now)
  const result = await db.transaction('rw', db.tasks, db.xpEvents, async () => {
    const task = await db.tasks.get(id)
    if (!task || task.status === 'done')
      return { task: task ?? null, xp: 0, next: null, changed: false }

    let next: Task | null = null
    const changes: Partial<Task> = { status: 'done', completedAt: now, completedDay: day }
    if (task.recurrence) {
      const due = nextDueAfterCompletion(task.recurrence, task.dueDate, day)
      next = buildNextInstance(task, { id: newId(), dueDate: due, now, newId })
      changes.seriesId = next.seriesId
    }
    await db.tasks.update(id, changes)
    if (next) await db.tasks.add(next)

    const amount = xpForTask({ estimate: task.estimatePomodoros, priority: task.priority })
    const award = await awardXp({
      source: 'task',
      amount,
      key: `task:${id}`,
      refId: id,
      at: now,
      day,
    })

    emit({ type: 'task.completed', taskId: id, day, at: now })
    if (next) emit({ type: 'task.created', taskId: next.id })
    return { task: (await db.tasks.get(id)) ?? null, xp: award?.amount ?? 0, next, changed: true }
  })

  const { changed, ...rest } = result
  if (!changed) return { ...rest, undo: noop }
  const generatedId = rest.next?.id ?? null
  // An undo happens later, so it is stamped with the time it runs, not the time of the action.
  return { ...rest, undo: async () => void (await reopen(id, generatedId, {})) }
}

/**
 * Finds the untouched, still-open instance that completing `task` created, so reopening the task does
 * not leave a duplicate in its series. `null` when there is none (or the user has since edited it).
 */
async function generatedInstance(task: Task, completedDay: ISODate): Promise<Task | null> {
  if (!task.recurrence || task.seriesId === null) return null
  const due = nextDueAfterCompletion(task.recurrence, task.dueDate, completedDay)
  const siblings = await db.tasks.where('seriesId').equals(task.seriesId).toArray()
  return (
    siblings.find(
      (t) =>
        t.id !== task.id &&
        t.status !== 'done' &&
        t.dueDate === due &&
        t.title === task.title &&
        t.updatedAt === t.createdAt,
    ) ?? null
  )
}

/**
 * Reopens a done task and reverses its XP. `generated` is the instance completion created (known for an
 * undo, `null` when there was none); `undefined` looks for one.
 */
async function reopen(
  id: ID,
  generated: ID | null | undefined,
  opts: RepoOptions,
): Promise<number> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.tasks, db.xpEvents, async () => {
    const task = await db.tasks.get(id)
    if (!task || task.status !== 'done') return 0
    const day = task.completedDay ?? dayOf(task.completedAt ?? now)

    await db.tasks.update(id, { status: 'todo', completedAt: null, completedDay: null })

    const created =
      generated === undefined
        ? await generatedInstance(task, day)
        : generated === null
          ? null
          : ((await db.tasks.get(generated)) ?? null)
    if (created && created.status !== 'done') {
      await db.tasks.delete(created.id)
      emit({ type: 'task.deleted', taskId: created.id })
    }

    const reversal = await reverseXp(`task:${id}`, { at: now })
    emit({ type: 'task.uncompleted', taskId: id, day })
    return reversal?.amount ?? 0
  })
}

export interface UncompleteResult extends Undoable {
  /** XP taken back (a negative number, or 0). */
  xp: number
}

/**
 * Reopens a finished task and appends the negative XP event (the log is append-only). If completing it
 * had created the next instance of a recurring series and nobody has touched that instance, it is
 * removed. `undo()` completes the task again.
 */
export async function uncompleteTask(id: ID, opts: RepoOptions = {}): Promise<UncompleteResult> {
  const xp = await reopen(id, undefined, opts)
  return { xp, undo: async () => void (await completeTask(id)) }
}

/**
 * Skips a task for today: it drops off Today and, when it belongs to a goal's plan, gives its minutes
 * back to the scheduler. A recurring task of your own moves to its next occurrence. `undo()` puts the
 * skip and any date change back.
 */
export async function skipTask(id: ID, opts: RepoOptions = {}): Promise<TaskUpdate | null> {
  const now = opts.now ?? Date.now()
  const today = dayOf(now)
  return db.transaction('rw', db.tasks, async () => {
    const before = await db.tasks.get(id)
    if (!before || before.status === 'done') return null
    const next: Partial<Task> = { skippedOn: today }
    if (before.recurrence && before.source !== 'schedule') {
      next.dueDate = nextDueAfterCompletion(before.recurrence, before.dueDate, today)
    }
    const { changes, previous } = diff(before, next)
    if (Object.keys(changes).length === 0) return { task: before, undo: noop }
    const task = await writeChanges(id, changes)
    return { task, undo: restoreFields(id, previous) }
  })
}

// ─── Move ───────────────────────────────────────────────────────────────────

export type OrderKey = 'order' | 'orderInDay' | 'boardOrder'

export interface MoveTarget {
  /** Change the due day (`null` clears it). */
  dueDate?: ISODate | null
  /** Change the time of day (`null` clears it). */
  dueTime?: HHmm | null
  /** Reorder: put the task between these two neighbours (either is `null` at the ends of a list). */
  reorder?: { above: ID | null; below: ID | null; key?: OrderKey }
}

async function orderOf(id: ID | null, key: OrderKey): Promise<number | null> {
  if (id === null) return null
  const row = await db.tasks.get(id)
  return row ? row[key] : null
}

/** Rewrites one order key across every task with even spacing, keeping the current sequence. */
async function renumber(key: OrderKey, movedId: ID, above: ID | null): Promise<void> {
  const all = await db.tasks.toArray()
  const sorted = all
    .filter((t) => t.id !== movedId)
    .sort((a, b) => a[key] - b[key] || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
  const at = above === null ? 0 : sorted.findIndex((t) => t.id === above) + 1
  const moved = all.find((t) => t.id === movedId)
  if (moved) sorted.splice(at, 0, moved)
  const orders = evenOrders(sorted.length)
  await db.tasks.bulkUpdate(
    sorted.map((t, i) => ({ key: t.id, changes: { [key]: orders[i] ?? 0 } as Partial<Task> })),
  )
}

/**
 * Moves a task: reorder it between two neighbours, and/or change its date or time. Reordering only
 * rewrites the moved row (fractional ordering); when neighbours have grown too close the whole list is
 * renumbered once. A date change on a scheduled task pins it. `undo()` restores the earlier values.
 */
export async function moveTask(
  id: ID,
  target: MoveTarget,
  opts: RepoOptions = {},
): Promise<TaskUpdate | null> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.tasks, async () => {
    const before = await db.tasks.get(id)
    if (!before) return null
    const patch: Partial<Task> = {}
    if ('dueDate' in target) patch.dueDate = target.dueDate ?? null
    if ('dueTime' in target) patch.dueTime = target.dueTime ?? null

    const reorder = target.reorder
    if (reorder) {
      const key = reorder.key ?? 'order'
      let above = await orderOf(reorder.above, key)
      let below = await orderOf(reorder.below, key)
      if (isCrowded(above, below)) {
        await renumber(key, id, reorder.above)
        above = await orderOf(reorder.above, key)
        below = await orderOf(reorder.below, key)
      }
      patch[key] = orderBetween(above, below)
    }

    const fresh = (await db.tasks.get(id)) ?? before
    const { changes, previous } = diff(fresh, settle(fresh, patch, now))
    // Earlier values come from before any renumbering, so undo returns to the old position.
    for (const key of Object.keys(previous) as (keyof Task)[]) {
      Object.assign(previous, { [key]: before[key] })
    }
    if (Object.keys(changes).length === 0) return { task: fresh, undo: noop }
    if (before.source === 'schedule' && ('dueDate' in changes || 'dueTime' in changes)) {
      changes.schedulePinned = true
      previous.schedulePinned = before.schedulePinned
    }
    const task = await writeChanges(id, changes)
    return { task, undo: restoreFields(id, previous) }
  })
}

// ─── Trash, duplicate ───────────────────────────────────────────────────────

/** Moves a task (its checklist goes with it) to the trash for 30 days. `undo()` restores it. */
export async function trashTask(id: ID, opts: RepoOptions = {}): Promise<TrashResult | null> {
  return moveToTrash('tasks', id, opts)
}

/**
 * A copy just below the original: the same content, open and unchecked, and detached from any
 * schedule or series.
 */
export async function duplicateTask(id: ID, opts: RepoOptions = {}): Promise<Task | null> {
  const now = opts.now ?? Date.now()
  const original = await db.tasks.get(id)
  if (!original) return null
  const orders = (await db.tasks.toArray()).map((t) => t.order).filter((o) => o > original.order)
  const nextOrder = orders.length > 0 ? Math.min(...orders) : null
  const notes: Block[] = original.notes.map((b) => ({ ...b, id: newId() }))
  return createTask(
    {
      ...original,
      id: undefined,
      notes,
      status: 'todo',
      source: original.source === 'schedule' ? 'user' : original.source,
      scheduleKey: null,
      schedulePinned: false,
      skippedOn: null,
      seriesId: null,
      subtasks: original.subtasks.map((s) => ({ ...s, id: newId(), done: false })),
      order: orderBetween(original.order, nextOrder),
      boardOrder: original.boardOrder,
      startedAt: null,
      completedAt: null,
      completedDay: null,
    },
    { now },
  )
}

// ─── Subtasks ───────────────────────────────────────────────────────────────

async function withSubtasks<T>(
  taskId: ID,
  edit: (subtasks: Subtask[]) => { subtasks: Subtask[]; result: T } | null,
): Promise<T | null> {
  return db.transaction('rw', db.tasks, async () => {
    const task = await db.tasks.get(taskId)
    if (!task) return null
    const edited = edit(task.subtasks.map((s) => ({ ...s })))
    if (!edited) return null
    await writeChanges(taskId, { subtasks: edited.subtasks })
    return edited.result
  })
}

/** Appends a checklist item. Returns it, or `null` for an empty title or a missing task. */
export async function addSubtask(taskId: ID, title: string): Promise<Subtask | null> {
  const clean = cleanTitle(title)
  if (clean === '') return null
  const item: Subtask = { id: newId(), title: clean, done: false }
  return withSubtasks(taskId, (list) => ({ subtasks: [...list, item], result: item }))
}

/** Renames and/or checks an item. An empty new title is ignored. */
export async function updateSubtask(
  taskId: ID,
  subtaskId: ID,
  patch: Partial<Pick<Subtask, 'title' | 'done'>>,
): Promise<boolean> {
  const title = patch.title === undefined ? undefined : cleanTitle(patch.title)
  const done = await withSubtasks(taskId, (list) => {
    const at = list.findIndex((s) => s.id === subtaskId)
    const current = list[at]
    if (!current) return null
    list[at] = {
      ...current,
      ...(title ? { title } : {}),
      ...(patch.done !== undefined ? { done: patch.done } : {}),
    }
    return { subtasks: list, result: true }
  })
  return done === true
}

export async function toggleSubtask(taskId: ID, subtaskId: ID): Promise<boolean> {
  const task = await db.tasks.get(taskId)
  const item = task?.subtasks.find((s) => s.id === subtaskId)
  if (!item) return false
  return updateSubtask(taskId, subtaskId, { done: !item.done })
}

/** Removes an item. `undo()` puts it back where it was. */
export async function removeSubtask(taskId: ID, subtaskId: ID): Promise<Undoable | null> {
  const removed = await withSubtasks(taskId, (list) => {
    const at = list.findIndex((s) => s.id === subtaskId)
    const item = list[at]
    if (!item) return null
    return { subtasks: list.filter((s) => s.id !== subtaskId), result: { item, at } }
  })
  if (!removed) return null
  return {
    undo: async () => {
      await withSubtasks(taskId, (list) => {
        if (list.some((s) => s.id === removed.item.id)) return null
        const at = Math.min(removed.at, list.length)
        return { subtasks: [...list.slice(0, at), removed.item, ...list.slice(at)], result: true }
      })
    },
  }
}

/** Moves an item to `toIndex` of the resulting list (clamped). */
export async function moveSubtask(taskId: ID, subtaskId: ID, toIndex: number): Promise<boolean> {
  const moved = await withSubtasks(taskId, (list) => {
    const at = list.findIndex((s) => s.id === subtaskId)
    const item = list[at]
    if (!item) return null
    const rest = list.filter((s) => s.id !== subtaskId)
    const target = Math.max(0, Math.min(rest.length, toIndex))
    if (target === at) return null
    return { subtasks: [...rest.slice(0, target), item, ...rest.slice(target)], result: true }
  })
  return moved === true
}
