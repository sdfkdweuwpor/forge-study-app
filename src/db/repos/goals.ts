/**
 * Goal writes (PLAN §1.2, §4.3). Two sections:
 * - CRUD (Phase 5B, goals UI): create/edit goals, courses and units, cascade trash.
 * - scheduling (architect-owned, at the bottom): `rebalanceGoal` materialises the plan as tasks, and
 *   `computeRemaining` summarises hours done and left. Keep its API stable; other features call it.
 */
import { dayOf } from '@/logic/dates'
import { deepEqual } from '@/logic/deepEqual'
import { CUS_MAX, HOURS_MAX, TITLE_MAX, type DraftRows } from '@/logic/goalDraft'
import { ORDER_STEP } from '@/logic/order'
import { minutesFromWeekly, planningForAvailability } from '@/logic/goalPlanning'
import {
  goalWork,
  planGoalSlots,
  type CatchUp,
  type GoalWork,
  type PlannerResult,
} from '@/logic/scheduler'
import { newId } from '@/lib/ids'
import { db } from '../db'
import { emit } from '../events'
import type { Goal, GoalProjection, ID, ISODate, Millis, Milestone, Unit } from '../types'
import { loadGoalRows, planTables, writePlanDiff } from './planning'
import { getSettings } from './settings'
import type { RepoOptions, Undoable } from './tasks'
import { moveToTrash, restoreFromTrash, trashTables, type TrashResult } from './trash'

// ─── CRUD (Phase 5B) ────────────────────────────────────────────────────────
//
// Every write that changes what the schedule should be (hours, order, prerequisites, units, titles that
// end up in task titles, availability, days off, dates) re-plans the goal afterwards with
// `rebalanceGoal(reason: 'edit')`, outside the write's own transaction, so a failed re-plan never
// loses the edit. Reads live in `features/goals/queries.ts`.

export interface GoalWriteOptions extends RepoOptions {
  /** Skip the automatic re-plan (tests that want to look at the raw write). Default: re-plan. */
  rebalance?: boolean
}

const noop = async (): Promise<void> => undefined
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()

async function replan(goalId: ID, reason: RebalanceReason, opts: GoalWriteOptions): Promise<void> {
  if (opts.rebalance === false) return
  await rebalanceGoal(goalId, { now: opts.now, reason })
}

/**
 * The order rows end up in when `orderedIds` is applied: the listed ids (ignoring unknown and repeated
 * ones) first, then every other row in its current order. `changed` are the ids whose position moves.
 */
function planOrder<T extends { id: ID; order: number; createdAt: number }>(
  rows: readonly T[],
  orderedIds: readonly ID[],
): { sorted: T[]; next: ID[]; changed: ID[] } {
  const sorted = [...rows].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  const known = new Set(sorted.map((r) => r.id))
  const listed = [...new Set(orderedIds)].filter((id) => known.has(id))
  const next = [...listed, ...sorted.map((r) => r.id).filter((id) => !listed.includes(id))]
  const byId = new Map(sorted.map((r) => [r.id, r]))
  return { sorted, next, changed: next.filter((id, i) => byId.get(id)?.order !== i) }
}

// ── Goals ───────────────────────────────────────────────────────────────────

export interface CreatedGoal {
  goal: Goal
  milestones: Milestone[]
  units: Unit[]
  /** The first plan, or `null` when re-planning was skipped or failed. */
  summary: RebalanceSummary | null
  /** Why the first plan could not be built. The goal itself was saved; a later re-plan can retry. */
  planError: unknown
}

/**
 * Saves a new goal with its courses and units (from `draftToRows`) in one transaction, appends it
 * after the last goal, then builds the first plan (`rebalanceGoal`, reason `wizard`, which also sets
 * the baseline end date). Throws for rows that do not belong together; a failed first plan is returned
 * as `planError` (the goal exists).
 */
export async function createGoalWithCourses(
  rows: DraftRows,
  opts: GoalWriteOptions = {},
): Promise<CreatedGoal> {
  const { milestones, units } = rows
  if (collapse(rows.goal.title) === '') throw new Error('A goal needs a title.')
  const courseIds = new Set(milestones.map((m) => m.id))
  if (courseIds.size !== milestones.length) throw new Error('Course ids must be unique.')
  if (milestones.some((m) => m.goalId !== rows.goal.id)) {
    throw new Error('Every course must belong to the new goal.')
  }
  if (units.some((u) => u.goalId !== rows.goal.id || !courseIds.has(u.milestoneId))) {
    throw new Error('Every unit must belong to a course of the new goal.')
  }

  const goal = await db.transaction('rw', [db.goals, db.milestones, db.units], async () => {
    const last = await db.goals.orderBy('order').last()
    const saved: Goal = { ...rows.goal, order: last ? last.order + ORDER_STEP : 0 }
    await db.goals.add(saved)
    if (milestones.length > 0) await db.milestones.bulkAdd(milestones)
    if (units.length > 0) await db.units.bulkAdd(units)
    emit({ type: 'goal.changed', goalId: saved.id })
    return saved
  })

  let summary: RebalanceSummary | null = null
  let planError: unknown = null
  if (opts.rebalance !== false) {
    try {
      summary = await rebalanceGoal(goal.id, { now: opts.now, reason: 'wizard' })
    } catch (error) {
      // The rows are saved. Failing here must not read as "nothing was created" (a retry would
      // duplicate the goal), so it is reported alongside the result.
      planError = error
    }
  }
  return { goal: (await db.goals.get(goal.id)) ?? goal, milestones, units, summary, planError }
}

/** The fields `updateGoal` may change. */
export type GoalPatch = Partial<
  Pick<
    Goal,
    | 'title'
    | 'icon'
    | 'cover'
    | 'kind'
    | 'status'
    | 'startDate'
    | 'targetDate'
    | 'availability'
    | 'planning'
    | 'terms'
    | 'notes'
  >
>

/**
 * Edits a goal. Only fields that actually change are written. A new title is trimmed (an empty one is
 * ignored). The v1 weekday minutes and the planning windows are kept in step: new minutes rebuild the
 * changed days' windows (from where each day started, else `settings.scheduling.defaultStudyStart`),
 * and new windows rewrite the minutes. Changing the start or target date, the availability or the
 * planning re-plans. Returns the goal as stored, or `null` when it does not exist.
 */
export async function updateGoal(
  id: ID,
  patch: GoalPatch,
  opts: GoalWriteOptions = {},
): Promise<Goal | null> {
  const now = opts.now ?? Date.now()
  const changes: Partial<Goal> = {}
  const studyStart =
    patch.availability !== undefined
      ? (await getSettings()).scheduling.defaultStudyStart
      : undefined
  const result = await db.transaction('rw', db.goals, async () => {
    const before = await db.goals.get(id)
    if (!before) return null
    for (const key of Object.keys(patch) as Array<keyof GoalPatch>) {
      const value = patch[key]
      if (value === undefined || deepEqual(before[key], value)) continue
      if (key === 'title') {
        const title = collapse(String(value)).slice(0, TITLE_MAX)
        if (title === '' || title === before.title) continue
        changes.title = title
      } else {
        Object.assign(changes, { [key]: value })
      }
    }
    if (changes.status !== undefined) {
      changes.completedAt = changes.status === 'done' ? now : null
    }
    if (changes.planning !== undefined) {
      const minutes = minutesFromWeekly(changes.planning.weekly)
      if (!deepEqual(minutes, before.availability.minutesByWeekday)) {
        changes.availability = {
          ...(changes.availability ?? before.availability),
          minutesByWeekday: minutes,
        }
      }
    } else if (changes.availability !== undefined) {
      const planning = planningForAvailability(
        before.planning,
        changes.availability,
        changes.targetDate !== undefined ? changes.targetDate : before.targetDate,
        studyStart,
      )
      if (!deepEqual(planning, before.planning)) changes.planning = planning
    }
    if (Object.keys(changes).length === 0) return before
    await db.goals.update(id, { ...changes, updatedAt: now })
    emit({ type: 'goal.changed', goalId: id })
    return { ...before, ...changes, updatedAt: now }
  })
  if (result === null) return null
  if (
    'startDate' in changes ||
    'targetDate' in changes ||
    'availability' in changes ||
    'planning' in changes
  ) {
    await replan(id, 'edit', opts)
    return (await db.goals.get(id)) ?? result
  }
  return result
}

/** Moves a goal and everything under it to the trash (30 days). `undo()` brings it all back. */
export async function trashGoal(id: ID, opts: RepoOptions = {}): Promise<TrashResult | null> {
  return moveToTrash('goals', id, opts)
}

// ── Courses ─────────────────────────────────────────────────────────────────

export interface NewCourse {
  title: string
  code?: string | null
  estimateHours?: number
  cus?: number | null
  courseType?: Milestone['courseType']
}

const clampHours = (h: number): number =>
  Number.isFinite(h) ? Math.max(0, Math.min(HOURS_MAX, Math.round(h * 100) / 100)) : 0

/** Adds a course at the end of a goal. Returns `null` when the goal or the title is missing. */
export async function createMilestone(
  goalId: ID,
  input: NewCourse,
  opts: GoalWriteOptions = {},
): Promise<Milestone | null> {
  const now = opts.now ?? Date.now()
  const title = collapse(input.title).slice(0, TITLE_MAX)
  if (title === '') return null
  const code = collapse(input.code ?? '')
  const saved = await db.transaction('rw', [db.goals, db.milestones], async () => {
    const goal = await db.goals.get(goalId)
    if (!goal) return null
    const siblings = await db.milestones.where('goalId').equals(goalId).toArray()
    const order = siblings.reduce((max, m) => Math.max(max, m.order), -1) + 1
    const row: Milestone = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      goalId,
      kind: 'course',
      code: code === '' ? null : code,
      title,
      icon: null,
      cover: null,
      status: 'todo',
      order,
      prerequisiteIds: [],
      estimateHours: clampHours(input.estimateHours ?? 0),
      dueDate: null,
      cus: input.cus ?? null,
      courseType: input.courseType ?? null,
      termId: goal.terms[0]?.id ?? null,
      notes: [],
      projectedStart: null,
      projectedEnd: null,
      completedAt: null,
      selfRating: null,
    }
    await db.milestones.add(row)
    emit({ type: 'goal.changed', goalId })
    return row
  })
  if (saved) await replan(goalId, 'edit', opts)
  return saved
}

/** The fields `updateMilestone` may change. Status has its own function (`setMilestoneStatus`). */
export type MilestonePatch = Partial<
  Pick<
    Milestone,
    | 'title'
    | 'code'
    | 'icon'
    | 'cover'
    | 'estimateHours'
    | 'cus'
    | 'courseType'
    | 'prerequisiteIds'
    | 'dueDate'
    | 'termId'
    | 'notes'
  >
>

/** What of a course ends up in the plan: hours, prerequisites, and the names in task titles. */
const PLAN_FIELDS: ReadonlyArray<keyof MilestonePatch> = [
  'title',
  'code',
  'estimateHours',
  'prerequisiteIds',
]

/**
 * Edits a course. A title is trimmed (an empty one is ignored), a code is trimmed (empty = none),
 * hours are clamped to 0…2000, and prerequisites are limited to other courses of the same goal.
 * Changing the title, code, hours or prerequisites re-plans. Returns the row as stored, or `null`.
 */
export async function updateMilestone(
  id: ID,
  patch: MilestonePatch,
  opts: GoalWriteOptions = {},
): Promise<Milestone | null> {
  const now = opts.now ?? Date.now()
  let goalId: ID | null = null
  let replanNeeded = false
  const result = await db.transaction('rw', [db.milestones], async () => {
    const before = await db.milestones.get(id)
    if (!before) return null
    goalId = before.goalId
    const changes: Partial<Milestone> = {}
    for (const key of Object.keys(patch) as Array<keyof MilestonePatch>) {
      let value: unknown = patch[key]
      if (value === undefined) continue
      if (key === 'title') {
        value = collapse(String(value)).slice(0, TITLE_MAX)
        if (value === '') continue
      } else if (key === 'code') {
        const code = collapse(String(value ?? ''))
        value = code === '' ? null : code
      } else if (key === 'estimateHours') {
        value = clampHours(Number(value))
      } else if (key === 'cus') {
        value = value === null ? null : Math.max(0, Math.min(CUS_MAX, Math.round(Number(value))))
      } else if (key === 'prerequisiteIds') {
        const siblings = await db.milestones.where('goalId').equals(before.goalId).primaryKeys()
        const known = new Set<ID>(siblings)
        value = [...new Set(value as ID[])].filter((p) => p !== id && known.has(p))
      }
      if (!deepEqual(before[key], value)) Object.assign(changes, { [key]: value })
    }
    const keys = Object.keys(changes) as Array<keyof MilestonePatch>
    if (keys.length === 0) return before
    replanNeeded = keys.some((k) => PLAN_FIELDS.includes(k))
    await db.milestones.update(id, { ...changes, updatedAt: now })
    emit({ type: 'goal.changed', goalId: before.goalId })
    return { ...before, ...changes, updatedAt: now }
  })
  if (result !== null && goalId !== null && replanNeeded) await replan(goalId, 'edit', opts)
  return result === null ? null : ((await db.milestones.get(id)) ?? result)
}

export interface StatusChange extends Undoable {
  milestone: Milestone
}

/**
 * Marks a course not started, in progress or done. Done stamps `completedAt`, emits
 * `milestone.completed` (the XP award is a listener's job), and re-plans with reason `complete`, which
 * pulls the later courses forward; anything else re-plans as an edit. `undo()` puts the previous
 * status back. Returns `null` for a missing course.
 */
export async function setMilestoneStatus(
  id: ID,
  status: Milestone['status'],
  opts: GoalWriteOptions = {},
): Promise<StatusChange | null> {
  const now = opts.now ?? Date.now()
  const before = await db.milestones.get(id)
  if (!before) return null
  if (before.status === status) return { milestone: before, undo: noop }

  const apply = async (
    next: Milestone['status'],
    completedAt: Millis | null,
    reason: RebalanceReason,
  ): Promise<Milestone> => {
    const row = await db.transaction('rw', db.milestones, async () => {
      await db.milestones.update(id, { status: next, completedAt, updatedAt: now })
      if (next === 'done') {
        emit({ type: 'milestone.completed', milestoneId: id, goalId: before.goalId })
      } else if (before.status === 'done') {
        emit({ type: 'milestone.uncompleted', milestoneId: id, goalId: before.goalId })
      }
      emit({ type: 'goal.changed', goalId: before.goalId })
      return { ...before, status: next, completedAt, updatedAt: now }
    })
    await replan(before.goalId, reason, opts)
    return row
  }

  const milestone = await apply(
    status,
    status === 'done' ? now : null,
    status === 'done' ? 'complete' : 'edit',
  )
  return {
    milestone,
    undo: async () => {
      const current = await db.milestones.get(id)
      if (!current) return
      await db.transaction('rw', db.milestones, async () => {
        await db.milestones.update(id, {
          status: before.status,
          completedAt: before.completedAt,
          updatedAt: Date.now(),
        })
        if (status === 'done') {
          emit({ type: 'milestone.uncompleted', milestoneId: id, goalId: before.goalId })
        } else if (before.status === 'done') {
          emit({ type: 'milestone.completed', milestoneId: id, goalId: before.goalId })
        }
        emit({ type: 'goal.changed', goalId: before.goalId })
      })
      await replan(before.goalId, 'edit', opts)
    },
  }
}

/**
 * Puts a goal's courses in the given order (`order` = position). Ids that are not of this goal are
 * ignored, and courses left out keep their relative order after the listed ones. `undo()` restores
 * the previous order. Re-plans, because courses are scheduled in this order.
 */
export async function reorderMilestones(
  goalId: ID,
  orderedIds: readonly ID[],
  opts: GoalWriteOptions = {},
): Promise<Undoable> {
  const now = opts.now ?? Date.now()
  const previous = await db.transaction('rw', db.milestones, async () => {
    const rows = await db.milestones.where('goalId').equals(goalId).toArray()
    const { sorted, next, changed } = planOrder(rows, orderedIds)
    if (changed.length === 0) return null
    for (const id of changed) {
      await db.milestones.update(id, { order: next.indexOf(id), updatedAt: now })
    }
    emit({ type: 'goal.changed', goalId })
    return sorted.map((m) => ({ id: m.id, order: m.order }))
  })
  if (previous === null) return { undo: noop }
  await replan(goalId, 'edit', opts)
  return {
    undo: async () => {
      await db.transaction('rw', db.milestones, async () => {
        for (const { id, order } of previous) {
          if (await db.milestones.get(id)) await db.milestones.update(id, { order })
        }
        emit({ type: 'goal.changed', goalId })
      })
      await replan(goalId, 'edit', opts)
    },
  }
}

/**
 * Moves a course (and its units, tasks and study material) to the trash. Other courses that listed it
 * as a prerequisite stop doing so; `undo()` restores the course, those prerequisites, and re-plans.
 * The goal is re-planned without the course. Returns `null` for a missing course.
 */
export async function trashMilestone(
  id: ID,
  opts: GoalWriteOptions = {},
): Promise<TrashResult | null> {
  const found = await db.transaction('rw', trashTables(), async () => {
    const course = await db.milestones.get(id)
    if (!course) return null
    const dependents = (await db.milestones.where('goalId').equals(course.goalId).toArray()).filter(
      (m) => m.prerequisiteIds.includes(id),
    )
    for (const m of dependents) {
      await db.milestones.update(m.id, {
        prerequisiteIds: m.prerequisiteIds.filter((p) => p !== id),
      })
    }
    const trashed = await moveToTrash('milestones', id, opts)
    return trashed
      ? {
          goalId: course.goalId,
          trashed,
          dependents: dependents.map((m) => ({ id: m.id, before: m.prerequisiteIds })),
        }
      : null
  })
  if (!found) return null
  const { goalId, trashed, dependents } = found
  await replan(goalId, 'edit', opts)
  return {
    ...trashed,
    undo: async () => {
      await restoreFromTrash(trashed.trashId)
      await db.transaction('rw', db.milestones, async () => {
        for (const d of dependents) {
          if (await db.milestones.get(d.id))
            await db.milestones.update(d.id, { prerequisiteIds: d.before })
        }
      })
      await replan(goalId, 'edit', opts)
    },
  }
}

// ── Units ───────────────────────────────────────────────────────────────────

export interface NewUnit {
  title: string
  /** `null` (or omitted) shares the course's leftover hours with the other units. */
  estimateMinutes?: number | null
  difficulty?: Unit['difficulty']
}

const clampMinutes = (m: number): number =>
  Number.isFinite(m) ? Math.max(5, Math.min(HOURS_MAX * 60, Math.round(m / 5) * 5)) : 5

/** Adds a unit at the end of a course. Returns `null` when the course or the title is missing. */
export async function createUnit(
  milestoneId: ID,
  input: NewUnit,
  opts: GoalWriteOptions = {},
): Promise<Unit | null> {
  const now = opts.now ?? Date.now()
  const title = collapse(input.title).slice(0, TITLE_MAX)
  if (title === '') return null
  const saved = await db.transaction('rw', [db.milestones, db.units], async () => {
    const course = await db.milestones.get(milestoneId)
    if (!course) return null
    const siblings = await db.units.where('milestoneId').equals(milestoneId).toArray()
    const minutes = input.estimateMinutes == null ? null : clampMinutes(input.estimateMinutes)
    const row: Unit = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      goalId: course.goalId,
      milestoneId,
      title,
      order: siblings.reduce((max, u) => Math.max(max, u.order), -1) + 1,
      estimateMinutes: minutes,
      difficulty: input.difficulty ?? 2,
      status: 'todo',
      completedAt: null,
      selfRating: null,
      estimateSource: minutes === null ? 'course' : 'hours',
      baseEstimateMinutes: minutes,
      optional: false,
    }
    await db.units.add(row)
    emit({ type: 'goal.changed', goalId: course.goalId })
    return row
  })
  if (saved) await replan(saved.goalId, 'edit', opts)
  return saved
}

/** The fields `updateUnit` may change. Done-ness has its own function (`setUnitDone`). */
export type UnitPatch = Partial<Pick<Unit, 'title' | 'estimateMinutes' | 'difficulty'>>

/** Edits a unit (an empty title is ignored; minutes are rounded to 5). Title and minutes re-plan. */
export async function updateUnit(
  id: ID,
  patch: UnitPatch,
  opts: GoalWriteOptions = {},
): Promise<Unit | null> {
  const now = opts.now ?? Date.now()
  let replanNeeded = false
  const result = await db.transaction('rw', db.units, async () => {
    const before = await db.units.get(id)
    if (!before) return null
    const changes: Partial<Unit> = {}
    if (patch.title !== undefined) {
      const title = collapse(patch.title).slice(0, TITLE_MAX)
      if (title !== '' && title !== before.title) changes.title = title
    }
    if (patch.estimateMinutes !== undefined) {
      const minutes = patch.estimateMinutes === null ? null : clampMinutes(patch.estimateMinutes)
      if (minutes !== before.estimateMinutes) {
        changes.estimateMinutes = minutes
        changes.baseEstimateMinutes = minutes
        changes.estimateSource = minutes === null ? 'course' : 'hours'
      }
    }
    if (patch.difficulty !== undefined && patch.difficulty !== before.difficulty) {
      changes.difficulty = patch.difficulty
    }
    if (Object.keys(changes).length === 0) return before
    replanNeeded = 'title' in changes || 'estimateMinutes' in changes
    await db.units.update(id, { ...changes, updatedAt: now })
    emit({ type: 'goal.changed', goalId: before.goalId })
    return { ...before, ...changes, updatedAt: now }
  })
  if (result !== null && replanNeeded) await replan(result.goalId, 'edit', opts)
  return result
}

export interface UnitChange extends Undoable {
  unit: Unit
}

/**
 * Checks a unit off (or reopens it). A finished unit has no work left, so its open scheduled tasks go
 * and the later work moves up (re-plan, reason `complete`). Checking the first unit of a course that
 * has not started marks it in progress. `undo()` restores both. Returns `null` for a missing unit.
 */
export async function setUnitDone(
  id: ID,
  done: boolean,
  opts: GoalWriteOptions = {},
): Promise<UnitChange | null> {
  const now = opts.now ?? Date.now()
  const outcome = await db.transaction('rw', [db.milestones, db.units], async () => {
    const before = await db.units.get(id)
    if (!before) return null
    if ((before.status === 'done') === done) return { before, course: null, next: before }
    const course = (await db.milestones.get(before.milestoneId)) ?? null
    const next: Unit = {
      ...before,
      status: done ? 'done' : 'todo',
      completedAt: done ? now : null,
      updatedAt: now,
    }
    await db.units.put(next)
    let started: Milestone | null = null
    if (done && course?.status === 'todo') {
      await db.milestones.update(course.id, { status: 'active', updatedAt: now })
      started = course
    }
    emit({ type: 'goal.changed', goalId: before.goalId })
    return { before, course: started, next }
  })
  if (outcome === null) return null
  const { before, course, next } = outcome
  if (next === before) return { unit: before, undo: noop }
  await replan(before.goalId, done ? 'complete' : 'edit', opts)
  return {
    unit: next,
    undo: async () => {
      await db.transaction('rw', [db.milestones, db.units], async () => {
        if (await db.units.get(id)) {
          await db.units.update(id, { status: before.status, completedAt: before.completedAt })
        }
        if (course && (await db.milestones.get(course.id))?.status === 'active') {
          await db.milestones.update(course.id, { status: 'todo' })
        }
        emit({ type: 'goal.changed', goalId: before.goalId })
      })
      await replan(before.goalId, 'edit', opts)
    },
  }
}

/** Puts a course's units in the given order (see `reorderMilestones`). `undo()` restores the old one. */
export async function reorderUnits(
  milestoneId: ID,
  orderedIds: readonly ID[],
  opts: GoalWriteOptions = {},
): Promise<Undoable> {
  const now = opts.now ?? Date.now()
  const outcome = await db.transaction('rw', db.units, async () => {
    const rows = await db.units.where('milestoneId').equals(milestoneId).toArray()
    const first = rows[0]
    if (!first) return null
    const { sorted, next, changed } = planOrder(rows, orderedIds)
    if (changed.length === 0) return null
    for (const unitId of changed) {
      await db.units.update(unitId, { order: next.indexOf(unitId), updatedAt: now })
    }
    emit({ type: 'goal.changed', goalId: first.goalId })
    return { goalId: first.goalId, previous: sorted.map((u) => ({ id: u.id, order: u.order })) }
  })
  if (outcome === null) return { undo: noop }
  await replan(outcome.goalId, 'edit', opts)
  return {
    undo: async () => {
      await db.transaction('rw', db.units, async () => {
        for (const { id, order } of outcome.previous) {
          if (await db.units.get(id)) await db.units.update(id, { order })
        }
        emit({ type: 'goal.changed', goalId: outcome.goalId })
      })
      await replan(outcome.goalId, 'edit', opts)
    },
  }
}

/** Moves a unit to the trash and re-plans without it; `undo()` restores it and re-plans again. */
export async function deleteUnit(id: ID, opts: GoalWriteOptions = {}): Promise<TrashResult | null> {
  const unit = await db.units.get(id)
  if (!unit) return null
  const trashed = await moveToTrash('units', id, opts)
  if (!trashed) return null
  emit({ type: 'goal.changed', goalId: unit.goalId })
  await replan(unit.goalId, 'edit', opts)
  return {
    ...trashed,
    undo: async () => {
      await restoreFromTrash(trashed.trashId)
      await replan(unit.goalId, 'edit', opts)
    },
  }
}

// ═══ scheduling (architect-owned, PLAN §4.3, §4.6) ══════════════════ BEGIN ═══

/** Why a rebalance ran. `wizard` (plan accepted) also resets the goal's baseline end date. */
export type RebalanceReason =
  | 'daily'
  | 'wizard'
  | 'import'
  | 'edit'
  | 'complete'
  | 'skip'
  | 'catchUp'
  | 'manual'
  | 'proposal'

export interface RebalanceOptions {
  /** Injected clock for tests; defaults to `Date.now()`. `today` is its local day. */
  now?: Millis
  reason?: RebalanceReason
}

export interface RebalanceSummary {
  goalId: ID
  reason: RebalanceReason
  today: ISODate
  result: PlannerResult
  catchUp: CatchUp | null
  /** What is now cached on `goal.projection`. */
  projection: GoalProjection
  inserted: number
  updated: number
  removed: number
  /** Unneeded items that carried the user's notes etc.: detached (plain tasks) and moved to the trash. */
  trashed: number
  /** Whether anything was written. A second rebalance on the same day with nothing new writes nothing. */
  changed: boolean
}

const sameProjection = (a: GoalProjection | null, b: GoalProjection): boolean =>
  a !== null && deepEqual({ ...a, computedAt: 0 }, { ...b, computedAt: 0 })

/**
 * Re-plans a goal from today with the slot planner (`planGoalSlots` → `planStudy`) and writes the
 * result, in one transaction:
 * - its open, unpinned plan items (study sessions, reviews, practice tests, assessments, weekly
 *   milestones) are moved and resized in place by `scheduleKey` (ids, notes, tags kept), new ones are
 *   created with their `kind`, `doDate`, `doTime` and `durationMinutes`, and items no longer needed are
 *   deleted, or detached and trashed when the user had added something to them;
 * - done tasks and active pins are left alone (a pin keeps its slot; it lapses once its day has
 *   passed, when it is skipped today, or when its unit is done);
 * - `goal.projection`, the courses' `projectedStart/End`, the accepted pace
 *   (`planning.paceMinutesPerStudyDay`) and `goal.lastRebalancedOn` are updated, and `baselineEnd` is
 *   set on `reason: 'wizard'` or when the goal has none yet.
 * Emits `task.*` events and `goal.changed` after commit, and only when something changed, so a
 * `goal.changed` → rebalance handler settles after one extra run. Returns `null` for a missing goal.
 * Any goal status is planned: callers (the daily run) decide which goals to rebalance.
 */
export async function rebalanceGoal(
  goalId: ID,
  opts: RebalanceOptions = {},
): Promise<RebalanceSummary | null> {
  const now = opts.now ?? Date.now()
  const today = dayOf(now)
  const reason = opts.reason ?? 'manual'

  return db.transaction('rw', planTables(), async () => {
    const rows = await loadGoalRows(goalId, today)
    if (!rows) return null
    const { goal, milestones } = rows
    const plan = planGoalSlots(rows, today)
    const { result } = plan
    const written = await writePlanDiff(goalId, plan.diff, now)

    let coursesChanged = 0
    for (const m of milestones) {
      const dates = plan.courseDates.get(m.id)
      if (!dates || (m.projectedStart === dates.start && m.projectedEnd === dates.end)) continue
      await db.milestones.update(m.id, { projectedStart: dates.start, projectedEnd: dates.end })
      coursesChanged++
    }

    const patch: Partial<Goal> = {}
    const projection: GoalProjection = { ...plan.projection, computedAt: now }
    const end = result.projectedEnd
    if (
      end !== null &&
      goal.baselineEnd !== end &&
      (reason === 'wizard' || goal.baselineEnd === null)
    ) {
      patch.baselineEnd = end
      // The plan was measured against the old baseline; against the new one it is exactly on time.
      if (goal.targetDate === null) projection.slipDays = 0
    }
    if (!sameProjection(goal.projection, projection)) patch.projection = projection
    const pace = result.pace.minutesPerStudyDay
    if (goal.planning.paceMinutesPerStudyDay !== pace) {
      patch.planning = { ...goal.planning, paceMinutesPerStudyDay: pace }
    }
    if (goal.lastRebalancedOn !== today) patch.lastRebalancedOn = today
    if (Object.keys(patch).length > 0) await db.goals.update(goalId, patch)

    const changed =
      written.inserted + written.updated + written.removed + written.trashed + coursesChanged > 0 ||
      Object.keys(patch).length > 0
    if (changed) emit({ type: 'goal.changed', goalId })

    return {
      goalId,
      reason,
      today,
      result,
      catchUp: plan.catchUp,
      projection: patch.projection ?? goal.projection ?? projection,
      ...written,
      changed,
    }
  })
}

/**
 * Minutes done and left for a goal and each of its courses (the goal page's "% of hours done").
 * `null` for a missing goal.
 */
export async function computeRemaining(goalId: ID): Promise<GoalWork | null> {
  return db.transaction('r', [db.goals, db.milestones, db.units, db.tasks], async () => {
    if (!(await db.goals.get(goalId))) return null
    const milestones = await db.milestones.where('goalId').equals(goalId).toArray()
    const units = await db.units.where('goalId').equals(goalId).toArray()
    const tasks = await db.tasks.where('goalId').equals(goalId).toArray()
    return goalWork({ milestones, units, tasks })
  })
}

// ═══ scheduling ═══════════════════════════════════════════════════════ END ═══
