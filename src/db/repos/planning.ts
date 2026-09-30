/**
 * A goal's plan in the database (schema v2): reading a goal's rows for the planner and writing plan
 * items as tasks. Shared by `rebalanceGoal` (goals.ts) and the plan proposals (proposals.ts); both run
 * these inside their own transaction over `planTables()`.
 */
import type { Table } from 'dexie'
import { newId } from '@/lib/ids'
import type { PlanTaskDiff, PlanTaskFields, SlotGoalRows } from '@/logic/scheduler'
import { db } from '../db'
import { emit } from '../events'
import type { Goal, ID, ISODate, Millis, Settings, Task } from '../types'
import { getSettings } from './settings'
import { moveToTrash, trashTables } from './trash'

/** Every table a re-plan or a proposal can touch. */
export function planTables(): Table[] {
  return [...trashTables(), db.settings]
}

export interface LoadedGoalRows extends SlotGoalRows {
  goal: Goal
  settings: Settings
}

/**
 * Everything `planGoalSlots` needs for a goal, read inside the caller's transaction: its courses,
 * units, tasks, planned assessments and readiness, the global days off, and the slots other tasks
 * hold from `today` on. `null` for a missing goal.
 */
export async function loadGoalRows(goalId: ID, today: ISODate): Promise<LoadedGoalRows | null> {
  const goal = await db.goals.get(goalId)
  if (!goal) return null
  const [milestones, units, tasks, plannedAssessments, readiness, settings, later] =
    await Promise.all([
      db.milestones.where('goalId').equals(goalId).toArray(),
      db.units.where('goalId').equals(goalId).toArray(),
      db.tasks.where('goalId').equals(goalId).toArray(),
      db.plannedAssessments.where('goalId').equals(goalId).toArray(),
      db.readiness.where('goalId').equals(goalId).toArray(),
      getSettings(),
      db.tasks.where('doDate').aboveOrEqual(today).toArray(),
    ])
  const busy = later.filter(
    (t) =>
      t.doTime !== null && t.status !== 'done' && !(t.goalId === goalId && t.source === 'schedule'),
  )
  return {
    goal,
    milestones,
    units,
    tasks,
    plannedAssessments,
    readiness,
    globalDaysOff: settings.scheduling.globalDaysOff,
    busy,
    weekStartsOn: settings.weekStartsOn,
    settings,
  }
}

/** A new task for a plan item. */
function planTaskRow(goalId: ID, fields: PlanTaskFields, now: Millis, order: number): Task {
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
    autoSlot: false,
    sync: null,
    ...fields,
  }
}

export interface WrittenDiff {
  inserted: number
  updated: number
  removed: number
  trashed: number
}

/**
 * Applies a plan diff to the goal's tasks (inside the caller's transaction): new items become tasks,
 * matched ones are moved and resized in place, unneeded ones are deleted, or detached and trashed when
 * the user had added something to them (restoring one brings back a plain task the plan leaves alone).
 * Emits the matching `task.*` events.
 */
export async function writePlanDiff(
  goalId: ID,
  diff: PlanTaskDiff,
  now: Millis,
): Promise<WrittenDiff> {
  const inserts = diff.insert.map((fields, i) => planTaskRow(goalId, fields, now, now + i))
  if (inserts.length > 0) await db.tasks.bulkAdd(inserts)
  if (diff.update.length > 0) {
    await db.tasks.bulkUpdate(diff.update.map((u) => ({ key: u.id, changes: u.changes })))
  }
  if (diff.remove.length > 0) await db.tasks.bulkDelete(diff.remove)
  for (const id of diff.trash) {
    await db.tasks.update(id, {
      source: 'user',
      kind: 'task',
      scheduleKey: null,
      schedulePinned: false,
      assessmentId: null,
    })
    await moveToTrash('tasks', id, { now })
  }
  for (const t of inserts) emit({ type: 'task.created', taskId: t.id })
  for (const u of diff.update) emit({ type: 'task.changed', taskId: u.id })
  for (const id of diff.remove) emit({ type: 'task.deleted', taskId: id })
  return {
    inserted: inserts.length,
    updated: diff.update.length,
    removed: diff.remove.length,
    trashed: diff.trash.length,
  }
}
