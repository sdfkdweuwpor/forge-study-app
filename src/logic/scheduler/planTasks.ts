/**
 * Planner items ↔ stored tasks (pure; schema v2). A goal's plan is materialised as real tasks
 * (`source: 'schedule'`) with a stable `scheduleKey` (the item key), a `kind`, a do date and time and a
 * duration. `diffPlanTasks` reconciles a new plan with the stored rows by key, as `diffSchedule` does for
 * the day-level scheduler, so a re-plan moves and resizes the same rows (keeping their ids, notes, tags
 * and checklists) instead of recreating them.
 *
 * Classification of the goal's plan tasks:
 * - done, or an active pin → `keep` (never touched);
 * - open and matched to an item → `update` when a plan-owned field differs (otherwise nothing);
 * - open and unmatched → `remove`, or `trash` when the user put something of their own on it;
 * - items nobody matched → `insert`.
 *
 * Study sessions are matched per unit in four passes, so skipping works (a task skipped today must not
 * be matched to a session dated today): it takes its own key if that session is on a later day,
 * otherwise a later session of the same unit (from an unskipped task if need be). Everything else keeps
 * its exact key. Reviews, practice tests, assessments and milestones only ever match their own key.
 */
import type { HHmm, ID, ISODate, PlanItemKind, Task } from '@/db/types'
import { hasUserContent, isActivePin } from './diff'
import { parseScheduleKey, pomodorosFor, taskMinutes, taskUnitId } from './estimates'
import { comparePlanItems } from './planner'
import type { CurrentPlanItem, PlanItem } from './plannerTypes'

/** The task fields a plan item owns; everything else on the row belongs to the user. */
export type PlanTaskFields = Pick<
  Task,
  | 'title'
  | 'kind'
  | 'doDate'
  | 'doTime'
  | 'durationMinutes'
  | 'estimateMinutes'
  | 'estimatePomodoros'
  | 'orderInDay'
  | 'scheduleKey'
  | 'milestoneId'
  | 'unitId'
  | 'assessmentId'
  | 'dueDate'
>

export type PlanTaskPatch = Partial<PlanTaskFields & Pick<Task, 'schedulePinned'>>

/** The fields `diffPlanTasks` reads. */
export type PlanTask = Pick<
  Task,
  | 'id'
  | 'createdAt'
  | 'status'
  | 'source'
  | 'scheduleKey'
  | 'schedulePinned'
  | 'skippedOn'
  | 'notes'
  | 'subtasks'
  | 'tags'
  | 'priority'
  | 'unitId'
  | 'milestoneId'
> &
  PlanTaskFields

const OWNED: ReadonlyArray<keyof PlanTaskFields> = [
  'title',
  'kind',
  'doDate',
  'doTime',
  'durationMinutes',
  'estimateMinutes',
  'estimatePomodoros',
  'orderInDay',
  'scheduleKey',
  'milestoneId',
  'unitId',
  'assessmentId',
  'dueDate',
]

/** The fields a plan item gives its task. Day markers (0 min) have no time, duration or estimate. */
export function planItemFields(item: PlanItem, orderInDay: number): PlanTaskFields {
  const minutes = item.durationMinutes > 0 ? item.durationMinutes : null
  return {
    title: item.title,
    kind: item.kind,
    doDate: item.doDate,
    doTime: minutes === null ? null : item.startTime,
    durationMinutes: minutes,
    estimateMinutes: minutes,
    estimatePomodoros: minutes === null ? null : pomodorosFor(minutes),
    orderInDay,
    scheduleKey: item.key,
    milestoneId: item.courseId,
    // A course without units is planned as one synthetic unit with the course's id: no unit row.
    unitId: item.unitId === null || item.unitId === item.courseId ? null : item.unitId,
    assessmentId: item.assessmentId,
    dueDate: item.dueDate,
  }
}

/** Each item's position within its day, in plan order. */
export function ordersInDay(items: readonly PlanItem[]): Map<string, number> {
  const out = new Map<string, number>()
  const perDay = new Map<ISODate, number>()
  for (const it of [...items].sort(comparePlanItems)) {
    const n = perDay.get(it.doDate) ?? 0
    out.set(it.key, n)
    perDay.set(it.doDate, n + 1)
  }
  return out
}

export interface PlanTaskUpdate {
  id: ID
  item: PlanItem
  /** Only the fields that actually change. */
  changes: PlanTaskPatch
}

export interface PlanTaskDiff {
  /** New items: create a task with these fields for each. */
  insert: PlanTaskFields[]
  update: PlanTaskUpdate[]
  /** Open, unpinned tasks the plan no longer needs and the user never touched: delete. */
  remove: ID[]
  /** Like `remove`, but carrying the user's notes, checklist, tags, priority or progress: detach and trash. */
  trash: ID[]
  /** Done tasks and active pins, left exactly as they are. */
  keep: ID[]
}

export interface PlanDiffContext {
  today: ISODate
  /** Tasks to treat as pinned. Default: `isActivePin(task, today)`. */
  pinnedIds?: ReadonlySet<ID>
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const seqOf = (t: PlanTask): number =>
  parseScheduleKey(t.scheduleKey)?.seq ?? Number.POSITIVE_INFINITY
const byAge = (a: PlanTask, b: PlanTask): number => a.createdAt - b.createdAt || cmpStr(a.id, b.id)
const bySeq = (a: PlanTask, b: PlanTask): number => seqOf(a) - seqOf(b) || byAge(a, b)

function patchFor(task: PlanTask, want: PlanTaskFields): PlanTaskPatch {
  const changes: PlanTaskPatch = {}
  for (const f of OWNED) if (task[f] !== want[f]) Object.assign(changes, { [f]: want[f] })
  if (task.schedulePinned) changes.schedulePinned = false
  return changes
}

/** Reconciles the goal's plan tasks with a new list of plan items (see the file comment). */
export function diffPlanTasks(
  existing: readonly PlanTask[],
  items: readonly PlanItem[],
  ctx: PlanDiffContext,
): PlanTaskDiff {
  const { today } = ctx
  const keep: ID[] = []
  const candidates: PlanTask[] = []
  for (const t of existing) {
    if (t.source !== 'schedule' || t.scheduleKey === null) continue
    const pinned = ctx.pinnedIds ? ctx.pinnedIds.has(t.id) : isActivePin(t, today)
    if (t.status === 'done' || pinned) keep.push(t.id)
    else candidates.push(t)
  }
  candidates.sort(byAge)

  const itemByKey = new Map<string, PlanItem>()
  const studyOfUnit = new Map<string, PlanItem[]>()
  for (const it of items) {
    if (itemByKey.has(it.key)) continue
    itemByKey.set(it.key, it)
    if (it.kind === 'study' && it.unitId !== null) {
      const list = studyOfUnit.get(it.unitId) ?? []
      list.push(it)
      studyOfUnit.set(it.unitId, list)
    }
  }
  for (const list of studyOfUnit.values()) list.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))

  const owner = new Map<string, PlanTask>()
  const match = new Map<ID, PlanItem>()
  const claim = (t: PlanTask, it: PlanItem): void => {
    owner.set(it.key, t)
    match.set(t.id, it)
  }
  const skipped = (t: PlanTask): boolean => t.skippedOn === today
  const later = (it: PlanItem): boolean => it.doDate !== today
  const isStudy = (t: PlanTask): boolean => t.kind === 'study'

  // 1. Skipped tasks keep their own key when that item is not today.
  for (const t of candidates) {
    if (!skipped(t) || t.scheduleKey === null) continue
    const it = itemByKey.get(t.scheduleKey)
    if (it && later(it) && !owner.has(it.key)) claim(t, it)
  }
  // 2. Everyone else keeps their own key (a skipped review or marker too: it has no other).
  for (const t of candidates) {
    if ((skipped(t) && isStudy(t)) || t.scheduleKey === null || match.has(t.id)) continue
    const it = itemByKey.get(t.scheduleKey)
    if (it && !owner.has(it.key)) claim(t, it)
  }
  // 3. Skipped study still unmatched takes a later session of its unit, from an unskipped task if need be.
  const bumped: PlanTask[] = []
  for (const t of candidates
    .filter((x) => skipped(x) && isStudy(x) && !match.has(x.id))
    .sort(bySeq)) {
    const unit = taskUnitId(t)
    const options = (unit !== null ? studyOfUnit.get(unit) : undefined) ?? []
    const free = options.find((it) => later(it) && !owner.has(it.key))
    const taken =
      free ??
      options.find((it) => {
        const holder = owner.get(it.key)
        return later(it) && holder !== undefined && !skipped(holder)
      })
    if (!taken) continue
    const prev = owner.get(taken.key)
    if (prev) {
      match.delete(prev.id)
      bumped.push(prev)
    }
    claim(t, taken)
  }
  // 4. Unskipped study without an item takes any free session of its unit.
  const rest = candidates.filter((x) => isStudy(x) && !skipped(x) && !match.has(x.id))
  for (const t of [...new Set([...rest, ...bumped])].sort(bySeq)) {
    if (match.has(t.id)) continue
    const unit = taskUnitId(t)
    const free = ((unit !== null ? studyOfUnit.get(unit) : undefined) ?? []).find(
      (it) => !owner.has(it.key),
    )
    if (free) claim(t, free)
  }

  const orders = ordersInDay(items)
  const fields = (it: PlanItem): PlanTaskFields => planItemFields(it, orders.get(it.key) ?? 0)
  const update: PlanTaskUpdate[] = []
  const remove: ID[] = []
  const trash: ID[] = []
  for (const t of candidates) {
    const it = match.get(t.id)
    if (!it) {
      if (hasUserContent(t)) trash.push(t.id)
      else remove.push(t.id)
      continue
    }
    const changes = patchFor(t, fields(it))
    if (Object.keys(changes).length > 0) update.push({ id: t.id, item: it, changes })
  }
  update.sort((a, b) => comparePlanItems(a.item, b.item) || cmpStr(a.id, b.id))
  const insert = [...itemByKey.values()]
    .filter((it) => !owner.has(it.key))
    .sort(comparePlanItems)
    .map(fields)

  return {
    insert,
    update,
    remove: remove.sort(cmpStr),
    trash: trash.sort(cmpStr),
    keep: keep.sort(cmpStr),
  }
}

export function isPlanDiffEmpty(diff: PlanTaskDiff): boolean {
  return (
    diff.insert.length === 0 &&
    diff.update.length === 0 &&
    diff.remove.length === 0 &&
    diff.trash.length === 0
  )
}

// ─── Stored tasks as a live plan ────────────────────────────────────────────

const PLAN_KINDS: ReadonlySet<string> = new Set<PlanItemKind>([
  'study',
  'review',
  'practiceTest',
  'assessment',
  'milestone',
])

/** Whether a task is an item of a goal's plan (a v1 chunk or a v2 planner item). */
export function isPlanTask(t: Pick<Task, 'source' | 'scheduleKey' | 'kind'>): boolean {
  return t.source === 'schedule' && t.scheduleKey !== null && PLAN_KINDS.has(t.kind)
}

/**
 * The goal's plan tasks as the live plan `rollForward` and `replanWeek` work on. Tasks without a do
 * date cannot be placed and are left out.
 */
export function currentPlanItems(tasks: readonly Task[], today: ISODate): CurrentPlanItem[] {
  const out: CurrentPlanItem[] = []
  for (const t of tasks) {
    if (!isPlanTask(t) || t.doDate === null || t.scheduleKey === null) continue
    const kind = t.kind as PlanItemKind
    const minutes = t.durationMinutes ?? taskMinutes(t)
    out.push({
      key: t.scheduleKey,
      kind,
      title: t.title,
      courseId: t.milestoneId,
      unitId: kind === 'study' ? taskUnitId(t) : t.unitId,
      assessmentId: t.assessmentId,
      doDate: t.doDate,
      startTime: t.doTime as HHmm | null,
      durationMinutes: t.doTime === null && kind !== 'study' ? 0 : minutes,
      dueDate: t.dueDate,
      status: t.status === 'done' ? 'done' : 'open',
      pinned: t.status !== 'done' && isActivePin(t, today),
    })
  }
  return out.sort(
    (a, b) =>
      cmpStr(a.doDate, b.doDate) ||
      cmpStr(a.startTime ?? '99:99', b.startTime ?? '99:99') ||
      cmpStr(a.key, b.key),
  )
}

/**
 * A short fingerprint of the open plan (key, slot and length of every open item). A proposal remembers
 * the one it was computed from; if the plan has changed since, the proposal is stale.
 */
export function planRevision(items: readonly CurrentPlanItem[]): string {
  const open = items.filter((i) => i.status === 'open')
  const text = open
    .map((i) => `${i.key}@${i.doDate} ${i.startTime ?? '-'}+${i.durationMinutes}`)
    .sort()
    .join('|')
  // FNV-1a, 32 bit.
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${open.length}-${h.toString(16).padStart(8, '0')}`
}
