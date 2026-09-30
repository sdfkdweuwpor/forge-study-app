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
import { kindForSource } from '@/logic/taskDates'
import { buildNextInstance, nextDateAfterCompletion, shiftedDeadline } from '@/logic/taskFlow'
import { cleanTags } from '@/logic/tagColor'
import { xpForTask } from '@/logic/xp'
import { db } from '../db'
import { emit } from '../events'
import type { Block, HHmm, ID, ISODate, Millis, Subtask, Task, TaskStatus } from '../types'
import { awardXp, reverseXp } from './xp'
import { moveToTrash, trashTables, type TrashResult } from './trash'

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
 * Creates a task at the end of the list. `doDate`/`doTime` say when to do it; `dueDate`/`dueTime` are a
 * hard deadline, only when there is one. A recurring task with no do date is anchored to the first day
 * its rule allows, on or after today. Does not award XP; finishing a task does (`completeTask`).
 */
export async function createTask(input: TaskInput, opts: RepoOptions = {}): Promise<Task> {
  const now = opts.now ?? Date.now()
  const title = cleanTitle(input.title)
  if (title === '') throw new RangeError('A task needs a title')

  const recurrence = input.recurrence ?? null
  const doDate = input.doDate ?? (recurrence ? firstOccurrence(recurrence, dayOf(now)) : null)
  const source = input.source ?? 'user'
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
    doDate,
    doTime: input.doTime ?? null,
    durationMinutes: input.durationMinutes ?? null,
    dueDate: input.dueDate ?? null,
    dueTime: input.dueTime ?? null,
    estimatePomodoros: input.estimatePomodoros ?? null,
    estimateMinutes: input.estimateMinutes ?? null,
    tags: cleanTags(input.tags ?? []),
    goalId: input.goalId ?? null,
    milestoneId: input.milestoneId ?? null,
    unitId: input.unitId ?? null,
    source,
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
    autoSlot: input.autoSlot ?? false,
    kind: input.kind ?? kindForSource(source),
    assessmentId: input.assessmentId ?? null,
    sync: input.sync ?? null,
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
    | 'doDate'
    | 'doTime'
    | 'durationMinutes'
    | 'dueDate'
    | 'dueTime'
    | 'autoSlot'
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

  // A recurring task with no do date is anchored to its rule.
  const recurrence = 'recurrence' in patch ? patch.recurrence : before.recurrence
  const doDate = 'doDate' in patch ? patch.doDate : before.doDate
  if (recurrence && (doDate === null || doDate === undefined)) {
    next.doDate = firstOccurrence(recurrence, dayOf(now))
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
 * `null` when the task no longer exists. A patch that changes nothing writes nothing. Editing the do
 * date or time of a scheduled task pins it, so a rebalance leaves it where you put it; its deadline
 * belongs to the plan and is not the user's to move.
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
      ('doDate' in changes || 'doTime' in changes)
    ) {
      changes.schedulePinned = true
      previous.schedulePinned = before.schedulePinned
    }
    const task = await writeChanges(id, changes)
    return { task, undo: restoreFields(id, previous) }
  })
}

/**
 * Sets todo, doing or done. Done goes through `completeTask`, and leaving done through `reopen`, so
 * XP and recurrence stay consistent; todo ⇄ doing only stamps `startedAt`. Reopening straight to doing
 * is one transaction (the XP reversal and the new status land together). Returns `null` for a
 * missing task.
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

  if (before.status === 'done') {
    await reopen(id, undefined, opts, { status, startedAt: status === 'doing' ? now : null })
    return { undo: async () => void (await completeTask(id)) }
  }

  const write = (changes: Partial<Task>) =>
    db.transaction('rw', db.tasks, async () => {
      if (await db.tasks.get(id)) await writeChanges(id, changes)
    })
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

/** What a task looks like when it is open again: the status it goes back to and its `startedAt`. */
interface ReopenState {
  status: 'todo' | 'doing'
  startedAt: Millis | null
}

const REOPEN_TODO: ReopenState = { status: 'todo', startedAt: null }

/**
 * Whether an open instance of the series is already planned for `doDate`. Completing a recurring task
 * again (complete, edit the generated instance, reopen, complete) must not stack a duplicate on it.
 */
async function openSiblingOn(task: Task, doDate: ISODate): Promise<boolean> {
  const siblings = await db.tasks
    .where('seriesId')
    .equals(task.seriesId ?? task.id)
    .toArray()
  return siblings.some((t) => t.id !== task.id && t.status !== 'done' && t.doDate === doDate)
}

/**
 * Marks a task done, awards `xpForTask` (idempotent per task), and, if it recurs, creates the next
 * instance, all in one transaction. Emits `task.completed`. `undo()` puts the task back the way it was
 * (todo or doing, with its `startedAt`), removes the instance it created and appends the negative XP
 * event, so the net XP is zero.
 */
export async function completeTask(id: ID, opts: RepoOptions = {}): Promise<CompleteResult> {
  const now = opts.now ?? Date.now()
  const day = dayOf(now)
  const result = await db.transaction('rw', db.tasks, db.xpEvents, async () => {
    const task = await db.tasks.get(id)
    if (!task || task.status === 'done')
      return { task: task ?? null, xp: 0, next: null, changed: false, restore: REOPEN_TODO }

    // What undo puts back, taken before anything changes.
    const restore: ReopenState = {
      status: task.status === 'doing' ? 'doing' : 'todo',
      startedAt: task.startedAt,
    }
    let next: Task | null = null
    const changes: Partial<Task> = { status: 'done', completedAt: now, completedDay: day }
    if (task.recurrence) {
      const on = nextDateAfterCompletion(task.recurrence, task.doDate, day)
      changes.seriesId = task.seriesId ?? task.id
      if (!(await openSiblingOn(task, on))) {
        next = buildNextInstance(task, { id: newId(), doDate: on, now, newId })
      }
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
    return {
      task: (await db.tasks.get(id)) ?? null,
      xp: award?.amount ?? 0,
      next,
      changed: true,
      restore,
    }
  })

  const { changed, restore, ...rest } = result
  if (!changed) return { ...rest, undo: noop }
  const generatedId = rest.next?.id ?? null
  // An undo happens later, so it is stamped with the time it runs, not the time of the action.
  return { ...rest, undo: async () => void (await reopen(id, generatedId, {}, restore)) }
}

/**
 * Finds the untouched, still-open instance that completing `task` created, so reopening the task does
 * not leave a duplicate in its series. `null` when there is none (or the user has since edited it).
 */
async function generatedInstance(task: Task, completedDay: ISODate): Promise<Task | null> {
  if (!task.recurrence || task.seriesId === null) return null
  const on = nextDateAfterCompletion(task.recurrence, task.doDate, completedDay)
  const siblings = await db.tasks.where('seriesId').equals(task.seriesId).toArray()
  return (
    siblings.find(
      (t) =>
        t.id !== task.id &&
        t.status !== 'done' &&
        t.doDate === on &&
        t.title === task.title &&
        t.updatedAt === t.createdAt,
    ) ?? null
  )
}

/**
 * Reopens a done task and reverses its XP. `generated` is the instance completion created (known for an
 * undo, `null` when there was none); `undefined` looks for one. The generated instance is deleted when
 * nobody has touched it and moved to the trash when they have, so an edit is never lost to an undo.
 * `to` is what the task becomes (todo, unless an undo knows it was doing).
 */
async function reopen(
  id: ID,
  generated: ID | null | undefined,
  opts: RepoOptions,
  to: ReopenState = REOPEN_TODO,
): Promise<number> {
  const now = opts.now ?? Date.now()
  // The trash writes several tables, and a nested transaction may only use tables its parent has.
  return db.transaction('rw', [...trashTables(), db.xpEvents], async () => {
    const task = await db.tasks.get(id)
    if (!task || task.status !== 'done') return 0
    const day = task.completedDay ?? dayOf(task.completedAt ?? now)

    await db.tasks.update(id, {
      status: to.status,
      startedAt: to.startedAt,
      completedAt: null,
      completedDay: null,
    })

    const created =
      generated === undefined
        ? await generatedInstance(task, day)
        : generated === null
          ? null
          : ((await db.tasks.get(generated)) ?? null)
    if (created && created.status !== 'done') {
      if (created.updatedAt === created.createdAt) {
        await db.tasks.delete(created.id)
        emit({ type: 'task.deleted', taskId: created.id })
      } else {
        await moveToTrash('tasks', created.id, { now })
      }
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
 * Reopens a finished task (to todo, or to doing with `to: 'doing'`) and appends the negative XP event
 * (the log is append-only). If completing it had created the next instance of a recurring series and
 * nobody has touched that instance, it is removed. `undo()` completes the task again.
 */
export async function uncompleteTask(
  id: ID,
  opts: RepoOptions & { to?: 'todo' | 'doing' } = {},
): Promise<UncompleteResult> {
  const to = opts.to ?? 'todo'
  const now = opts.now ?? Date.now()
  const xp = await reopen(id, undefined, opts, {
    status: to,
    startedAt: to === 'doing' ? now : null,
  })
  return { xp, undo: async () => void (await completeTask(id)) }
}

/**
 * Skips a task for today: it drops off Today and, when it belongs to a goal's plan, gives its slot
 * back to the planner. A recurring task of your own moves to its next occurrence (its deadline moves
 * with it). `undo()` puts the skip and any date change back.
 */
export async function skipTask(id: ID, opts: RepoOptions = {}): Promise<TaskUpdate | null> {
  const now = opts.now ?? Date.now()
  const today = dayOf(now)
  return db.transaction('rw', db.tasks, async () => {
    const before = await db.tasks.get(id)
    if (!before || before.status === 'done') return null
    const next: Partial<Task> = { skippedOn: today }
    if (before.recurrence && before.source !== 'schedule') {
      next.doDate = nextDateAfterCompletion(before.recurrence, before.doDate, today)
      next.dueDate = shiftedDeadline(before, next.doDate)
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
  /** Change the do day (`null` clears it). The deadline never moves with a drag. */
  doDate?: ISODate | null
  /** Change the planned time of day (`null` clears it). */
  doTime?: HHmm | null
  /** Reorder: put the task between these two neighbours (either is `null` at the ends of a list). */
  reorder?: { above: ID | null; below: ID | null; key?: OrderKey }
}

async function orderOf(id: ID | null, key: OrderKey): Promise<number | null> {
  if (id === null) return null
  const row = await db.tasks.get(id)
  return row ? row[key] : null
}

/** Rows in the order `key` gives them, ties broken by age and id so the sequence is always the same. */
function inOrder(rows: readonly Task[], key: OrderKey): Task[] {
  return [...rows].sort(
    (a, b) => a[key] - b[key] || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  )
}

interface Neighbours {
  above: ID | null
  below: ID | null
}

/** The rows on either side of `id` in the whole list ordered by `key`. */
async function neighboursOf(id: ID, key: OrderKey): Promise<Neighbours> {
  const sorted = inOrder(await db.tasks.toArray(), key)
  const at = sorted.findIndex((t) => t.id === id)
  return { above: sorted[at - 1]?.id ?? null, below: sorted[at + 1]?.id ?? null }
}

/**
 * Rewrites one order key across every task with even spacing, keeping the current sequence and leaving
 * a slot for the moved row. Only rows whose number actually changes are written (the moved row is
 * placed by the caller), so a renumber does not make untouched tasks look edited.
 */
async function renumber(key: OrderKey, movedId: ID, above: ID | null): Promise<void> {
  const all = await db.tasks.toArray()
  const sorted = inOrder(
    all.filter((t) => t.id !== movedId),
    key,
  )
  const at = above === null ? 0 : sorted.findIndex((t) => t.id === above) + 1
  const moved = all.find((t) => t.id === movedId)
  if (moved) sorted.splice(at, 0, moved)
  const orders = evenOrders(sorted.length)
  const updates: Array<{ key: ID; changes: Partial<Task> }> = []
  sorted.forEach((t, i) => {
    const order = orders[i] ?? 0
    if (t.id !== movedId && t[key] !== order) {
      updates.push({ key: t.id, changes: { [key]: order } as Partial<Task> })
    }
  })
  if (updates.length > 0) await db.tasks.bulkUpdate(updates)
}

/**
 * The order value that puts `id` back between the neighbours it had before it moved, renumbering first
 * if they have since been squeezed together. `null` when that position no longer exists (a neighbour
 * was deleted, or they have been reordered past each other).
 */
async function positionBetween(
  id: ID,
  key: OrderKey,
  original: Neighbours,
): Promise<number | null> {
  let above = await orderOf(original.above, key)
  let below = await orderOf(original.below, key)
  if ((original.above !== null && above === null) || (original.below !== null && below === null)) {
    return null
  }
  if (above !== null && below !== null && above >= below) return null
  if (isCrowded(above, below)) {
    await renumber(key, id, original.above)
    above = await orderOf(original.above, key)
    below = await orderOf(original.below, key)
  }
  return orderBetween(above, below)
}

/**
 * Moves a task: reorder it between two neighbours, and/or change its do date or time. Reordering only
 * rewrites the moved row (fractional ordering); when neighbours have grown too close the whole list is
 * renumbered once. A date change on a scheduled task pins it. `undo()` puts the date and time back and
 * puts the task back between the neighbours it had (not at its old number, which a renumber may have
 * made meaningless).
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
    if ('doDate' in target) patch.doDate = target.doDate ?? null
    if ('doTime' in target) patch.doTime = target.doTime ?? null

    const reorder = target.reorder
    const key: OrderKey = reorder?.key ?? 'order'
    let original: Neighbours | null = null
    if (reorder) {
      original = await neighboursOf(id, key)
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
    for (const field of Object.keys(previous) as (keyof Task)[]) {
      Object.assign(previous, { [field]: before[field] })
    }
    if (Object.keys(changes).length === 0) return { task: fresh, undo: noop }
    if (before.source === 'schedule' && ('doDate' in changes || 'doTime' in changes)) {
      changes.schedulePinned = true
      previous.schedulePinned = before.schedulePinned
    }
    const task = await writeChanges(id, changes)
    if (!original || !(key in changes)) return { task, undo: restoreFields(id, previous) }

    const neighbours = original
    return {
      task,
      undo: async () => {
        await db.transaction('rw', db.tasks, async () => {
          if (!(await db.tasks.get(id))) return
          const restore: Partial<Task> = { ...previous }
          // The old number is only a fallback: relative to its neighbours is what "back" means.
          const placed = await positionBetween(id, key, neighbours)
          if (placed !== null) restore[key] = placed
          await writeChanges(id, restore)
        })
      },
    }
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
      kind: original.source === 'schedule' ? 'task' : original.kind,
      assessmentId: original.source === 'schedule' ? null : original.assessmentId,
      sync: null,
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
