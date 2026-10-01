/**
 * Reconciling a new plan with the goal's existing scheduled tasks (pure). Tasks are matched by their
 * stable `scheduleKey` (`${unitId}:${seq}`), so a rebalance moves and resizes the same rows (keeping
 * their ids, notes, tags and time) instead of recreating them.
 *
 * Classification of the goal's `source: 'schedule'` tasks:
 * - done, or an active pin → `keep` (never touched);
 * - open and matched to a chunk → `update` when a chunk-owned field differs (otherwise nothing);
 * - open and unmatched → `remove`, or `trash` when the user put something of their own on it;
 * - chunks nobody matched → `insert`.
 *
 * Matching runs per unit in four passes, so skipping works: a task skipped today must not be matched
 * to a chunk dated today. It takes its own key if that chunk is later; otherwise a later chunk of the
 * same unit (taking it from an unskipped task if need be, which then takes today's). Other tasks take
 * their exact key, then any free chunk of their unit, lowest number first.
 */
import type { Block, ID, ISODate, Task } from '@/db/types'
import { parseScheduleKey, pomodorosFor, taskUnitId } from './estimates'
import type {
  ChunkFields,
  ChunkPatch,
  ChunkUpdate,
  DiffTask,
  PlannedChunk,
  ScheduleDiff,
} from './types'

/** A pin the rebalancer must respect: open, not skipped today, and not dated in the past. */
export function isActivePin(
  task: Pick<Task, 'status' | 'schedulePinned' | 'doDate' | 'skippedOn'>,
  today: ISODate,
): boolean {
  return (
    task.status !== 'done' &&
    task.schedulePinned &&
    task.skippedOn !== today &&
    (task.doDate === null || task.doDate >= today)
  )
}

const hasText = (b: Block): boolean => b.text.trim() !== ''

/** Whether the user added anything to a scheduled task that would be lost if it were deleted. */
export function hasUserContent(
  task: Pick<Task, 'status' | 'priority' | 'tags' | 'subtasks' | 'notes'>,
): boolean {
  return (
    task.status === 'doing' ||
    task.priority !== 0 ||
    task.tags.length > 0 ||
    task.subtasks.length > 0 ||
    task.notes.some(hasText)
  )
}

/** The task fields a chunk sets. A course without units has no unit row, so `unitId` is null. */
export function chunkFields(chunk: PlannedChunk): ChunkFields {
  return {
    title: chunk.title,
    doDate: chunk.date,
    estimateMinutes: chunk.minutes,
    estimatePomodoros: pomodorosFor(chunk.minutes),
    orderInDay: chunk.orderInDay,
    scheduleKey: chunk.key,
    milestoneId: chunk.courseId,
    unitId: chunk.unitId === chunk.courseId ? null : chunk.unitId,
  }
}

const FIELDS: ReadonlyArray<keyof ChunkFields> = [
  'title',
  'doDate',
  'estimateMinutes',
  'estimatePomodoros',
  'orderInDay',
  'scheduleKey',
  'milestoneId',
  'unitId',
]

function patchFor(task: DiffTask, chunk: PlannedChunk): ChunkPatch {
  const want = chunkFields(chunk)
  const changes: ChunkPatch = {}
  for (const f of FIELDS) {
    if (task[f] !== want[f]) Object.assign(changes, { [f]: want[f] })
  }
  if (task.schedulePinned) changes.schedulePinned = false
  return changes
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const seqOf = (t: DiffTask): number =>
  parseScheduleKey(t.scheduleKey)?.seq ?? Number.POSITIVE_INFINITY
const byAge = (a: DiffTask, b: DiffTask): number => a.createdAt - b.createdAt || cmpStr(a.id, b.id)
const bySeq = (a: DiffTask, b: DiffTask): number => seqOf(a) - seqOf(b) || byAge(a, b)

export interface DiffContext {
  today: ISODate
  /** Tasks to treat as pinned. Default: `isActivePin(task, today)`. */
  pinnedIds?: ReadonlySet<ID>
}

export function diffSchedule(
  existing: readonly DiffTask[],
  chunks: readonly PlannedChunk[],
  ctx: DiffContext,
): ScheduleDiff {
  const { today } = ctx
  const keep: ID[] = []
  const candidates: DiffTask[] = []
  for (const t of existing) {
    if (t.source !== 'schedule') continue
    const pinned = ctx.pinnedIds ? ctx.pinnedIds.has(t.id) : isActivePin(t, today)
    if (t.status === 'done' || pinned) keep.push(t.id)
    else candidates.push(t)
  }
  candidates.sort(byAge)

  const chunkByKey = new Map<string, PlannedChunk>()
  const chunksOfUnit = new Map<string, PlannedChunk[]>()
  for (const c of chunks) {
    if (chunkByKey.has(c.key)) continue
    chunkByKey.set(c.key, c)
    const list = chunksOfUnit.get(c.unitId) ?? []
    list.push(c)
    chunksOfUnit.set(c.unitId, list)
  }
  for (const list of chunksOfUnit.values()) list.sort((a, b) => a.seq - b.seq)

  const owner = new Map<string, DiffTask>() // chunk key → task
  const match = new Map<ID, PlannedChunk>() // task id → chunk
  const claim = (t: DiffTask, c: PlannedChunk): void => {
    owner.set(c.key, t)
    match.set(t.id, c)
  }
  const skipped = (t: DiffTask): boolean => t.skippedOn === today
  const later = (c: PlannedChunk): boolean => c.date !== today

  // 1. Skipped tasks keep their own key when that chunk is not today.
  for (const t of candidates) {
    if (!skipped(t) || !t.scheduleKey) continue
    const c = chunkByKey.get(t.scheduleKey)
    if (c && later(c) && !owner.has(c.key)) claim(t, c)
  }
  // 2. Everyone else keeps their own key.
  for (const t of candidates) {
    if (skipped(t) || !t.scheduleKey) continue
    const c = chunkByKey.get(t.scheduleKey)
    if (c && !owner.has(c.key)) claim(t, c)
  }
  // 3. Skipped tasks still unmatched take a later chunk of their unit, from an unskipped task if needed.
  const bumped: DiffTask[] = []
  for (const t of candidates.filter((x) => skipped(x) && !match.has(x.id)).sort(bySeq)) {
    const unit = taskUnitId(t)
    const options = (unit !== null ? chunksOfUnit.get(unit) : undefined) ?? []
    const free = options.find((c) => later(c) && !owner.has(c.key))
    const taken =
      free ??
      options.find((c) => {
        const holder = owner.get(c.key)
        return later(c) && holder !== undefined && !skipped(holder)
      })
    if (!taken) continue
    const prev = owner.get(taken.key)
    if (prev) {
      match.delete(prev.id)
      bumped.push(prev)
    }
    claim(t, taken)
  }
  // 4. Unskipped tasks without a chunk take any free chunk of their unit.
  const rest = candidates.filter((x) => !skipped(x) && !match.has(x.id))
  for (const t of [...new Set([...rest, ...bumped])].sort(bySeq)) {
    if (match.has(t.id)) continue
    const unit = taskUnitId(t)
    const free = ((unit !== null ? chunksOfUnit.get(unit) : undefined) ?? []).find(
      (c) => !owner.has(c.key),
    )
    if (free) claim(t, free)
  }

  const position = new Map<string, number>()
  chunks.forEach((c, i) => {
    if (!position.has(c.key)) position.set(c.key, i)
  })
  const update: ChunkUpdate[] = []
  const remove: ID[] = []
  const trash: ID[] = []
  for (const t of candidates) {
    const c = match.get(t.id)
    if (!c) {
      if (hasUserContent(t)) trash.push(t.id)
      else remove.push(t.id)
      continue
    }
    const changes = patchFor(t, c)
    if (Object.keys(changes).length > 0) update.push({ id: t.id, chunk: c, changes })
  }
  update.sort(
    (a, b) =>
      (position.get(a.chunk.key) ?? 0) - (position.get(b.chunk.key) ?? 0) || cmpStr(a.id, b.id),
  )
  const insert = [...chunkByKey.values()].filter((c) => !owner.has(c.key))

  return {
    insert,
    update,
    remove: remove.sort(cmpStr),
    trash: trash.sort(cmpStr),
    keep: keep.sort(cmpStr),
  }
}

/** True when applying the diff would change nothing. */
export function isDiffEmpty(diff: ScheduleDiff): boolean {
  return (
    diff.insert.length === 0 &&
    diff.update.length === 0 &&
    diff.remove.length === 0 &&
    diff.trash.length === 0
  )
}
