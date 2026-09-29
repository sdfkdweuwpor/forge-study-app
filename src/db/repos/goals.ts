/**
 * Goal writes (PLAN §1.2, §4.3). Two sections:
 * - CRUD (Phase 5B, goals UI): create/edit goals, courses and units, cascade trash.
 * - scheduling (architect-owned, at the bottom): `rebalanceGoal` materialises the plan as tasks, and
 *   `computeRemaining` summarises hours done and left. Keep its API stable; other features call it.
 */
import { dayOf } from '@/logic/dates'
import { deepEqual } from '@/logic/deepEqual'
import {
  chunkFields,
  goalWork,
  planGoal,
  type CatchUp,
  type GoalWork,
  type PlannedChunk,
  type ScheduleResult,
  type SchedulerOptions,
} from '@/logic/scheduler'
import { newId } from '@/lib/ids'
import { db } from '../db'
import { emit } from '../events'
import type { Goal, GoalProjection, ID, ISODate, Millis, Task } from '../types'
import { getSettings } from './settings'
import { moveToTrash, trashTables } from './trash'

// ─── CRUD (Phase 5B) ────────────────────────────────────────────────────────

// ═══ scheduling (architect-owned, PLAN §4.3) ════════════════════════ BEGIN ═══

/** Why a rebalance ran. `wizard` (plan accepted) also resets the goal's baseline end date. */
export type RebalanceReason =
  'daily' | 'wizard' | 'import' | 'edit' | 'complete' | 'skip' | 'catchUp' | 'manual'

export interface RebalanceOptions {
  /** Injected clock for tests; defaults to `Date.now()`. `today` is its local day. */
  now?: Millis
  reason?: RebalanceReason
  /** Scheduler tuning (tests). */
  scheduler?: Partial<SchedulerOptions>
}

export interface RebalanceSummary {
  goalId: ID
  reason: RebalanceReason
  today: ISODate
  result: ScheduleResult
  catchUp: CatchUp | null
  /** What is now cached on `goal.projection`. */
  projection: GoalProjection
  inserted: number
  updated: number
  removed: number
  /** Unneeded chunks that carried the user's notes etc.: detached (plain tasks) and moved to the trash. */
  trashed: number
  /** Whether anything was written. A second rebalance on the same day with nothing new writes nothing. */
  changed: boolean
}

function chunkTask(goalId: ID, chunk: PlannedChunk, now: Millis, order: number): Task {
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    notes: [],
    status: 'todo',
    priority: 0,
    dueTime: null,
    tags: [],
    goalId,
    source: 'schedule',
    schedulePinned: false,
    skippedOn: null,
    subtasks: [],
    recurrence: null,
    seriesId: null,
    order,
    boardOrder: order,
    startedAt: null,
    completedAt: null,
    completedDay: null,
    ...chunkFields(chunk),
  }
}

const sameProjection = (a: GoalProjection | null, b: GoalProjection): boolean =>
  a !== null && deepEqual({ ...a, computedAt: 0 }, { ...b, computedAt: 0 })

/**
 * Re-plans a goal from today and writes the result, in one transaction:
 * - its open, unpinned scheduled tasks are moved and resized in place by `scheduleKey` (ids, notes,
 *   tags and times kept), new chunks are created, and chunks no longer needed are deleted, or detached
 *   and trashed when the user had added something to them;
 * - done tasks and active pins are left alone (a pin uses its day's capacity; it lapses once its day
 *   has passed, when it is skipped today, or when its unit is done);
 * - `goal.projection`, the courses' `projectedStart/End` and `goal.lastRebalancedOn` are updated, and
 *   `baselineEnd` is set on `reason: 'wizard'` or when the goal has none yet.
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

  return db.transaction('rw', [...trashTables(), db.settings], async () => {
    const goal = await db.goals.get(goalId)
    if (!goal) return null
    const milestones = await db.milestones.where('goalId').equals(goalId).toArray()
    const units = await db.units.where('goalId').equals(goalId).toArray()
    const tasks = await db.tasks.where('goalId').equals(goalId).toArray()
    const settings = await getSettings()

    const plan = planGoal(
      { goal, milestones, units, tasks, globalDaysOff: settings.scheduling.globalDaysOff },
      today,
      opts.scheduler,
    )
    const { diff, result } = plan

    const inserts = diff.insert.map((chunk, i) => chunkTask(goalId, chunk, now, now + i))
    if (inserts.length > 0) await db.tasks.bulkAdd(inserts)
    if (diff.update.length > 0) {
      await db.tasks.bulkUpdate(diff.update.map((u) => ({ key: u.id, changes: u.changes })))
    }
    if (diff.remove.length > 0) await db.tasks.bulkDelete(diff.remove)
    for (const id of diff.trash) {
      // Detached first, so restoring it from the trash brings back a plain task the plan leaves alone.
      await db.tasks.update(id, { source: 'user', scheduleKey: null, schedulePinned: false })
      await moveToTrash('tasks', id, { now })
    }
    for (const t of inserts) emit({ type: 'task.created', taskId: t.id })
    for (const u of diff.update) emit({ type: 'task.changed', taskId: u.id })
    for (const id of diff.remove) emit({ type: 'task.deleted', taskId: id })

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
    if (goal.lastRebalancedOn !== today) patch.lastRebalancedOn = today
    if (Object.keys(patch).length > 0) await db.goals.update(goalId, patch)

    const changed =
      inserts.length +
        diff.update.length +
        diff.remove.length +
        diff.trash.length +
        coursesChanged >
        0 || Object.keys(patch).length > 0
    if (changed) emit({ type: 'goal.changed', goalId })

    return {
      goalId,
      reason,
      today,
      result,
      catchUp: plan.catchUp,
      projection: patch.projection ?? goal.projection ?? projection,
      inserted: inserts.length,
      updated: diff.update.length,
      removed: diff.remove.length,
      trashed: diff.trash.length,
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
