/**
 * Database access for the Claude plan import: the live read of the goal being merged into, and the
 * write itself. This is the one file of the import that may use the Dexie instance (PLAN §1.1).
 *
 * `applyPlanImport` is one transaction and returns the means to reverse it. Undo is deliberately
 * simple: the rows the import touched were snapshotted first, so undo deletes the rows it added and
 * puts the old ones back (or, for a new goal, removes the goal). The caller re-plans afterwards.
 *
 * Why not `createGoalWithCourses` / `updateMilestone` / `createUnit` from `@/db/repos/goals`? Each of
 * those opens its own transaction and re-plans the goal per call, so a merge of N courses would be
 * non-atomic with N rebalances and no exact undo, and `createMilestone` links every course to the goal's
 * first term where the import applies its own term rule. The import needs one transaction over the whole
 * plan and one re-plan at the end. If a repo-level "apply a plan" ever exists, this file is the only
 * place to change.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { emit } from '@/db/events'
import type { Goal, ID, ISODate, Milestone, Task, Unit } from '@/db/types'
import { newId } from '@/lib/ids'
import { ORDER_STEP } from '@/logic/order'
import { planToOps, type ExistingGoal, type ImportOps, type Plan } from '@/logic/planImport'

export type ImportTarget = { kind: 'goal'; goalId: ID } | { kind: 'new' }

/** A goal with its courses and their units, as the import sees it. `null`: no such goal. */
export async function loadGoalSnapshot(goalId: ID): Promise<ExistingGoal | null> {
  const goal = await db.goals.get(goalId)
  if (!goal) return null
  const [milestones, units] = await Promise.all([
    db.milestones.where('goalId').equals(goalId).toArray(),
    db.units.where('goalId').equals(goalId).toArray(),
  ])
  milestones.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  return {
    goal,
    courses: milestones.map((milestone) => ({
      milestone,
      units: units.filter((u) => u.milestoneId === milestone.id).sort((a, b) => a.order - b.order),
    })),
  }
}

/** Every task filed under the goal: its scheduled study blocks and anything the user added. */
export async function loadGoalTasks(goalId: ID): Promise<Task[]> {
  return db.tasks.where('goalId').equals(goalId).toArray()
}

/**
 * Live goal snapshot: `undefined` while loading, `null` when the goal does not exist. Pass `null` when
 * there is no target goal (a new-goal import): it resolves to `null` without a query.
 */
export function useGoalSnapshot(goalId: ID | null): ExistingGoal | null | undefined {
  return useLiveQuery(() => (goalId === null ? null : loadGoalSnapshot(goalId)), [goalId], undefined)
}

/** The first goal in list order (`undefined` while loading, `null` when there is none). */
export function useFirstGoalId(): ID | null | undefined {
  return useLiveQuery(
    async () => (await db.goals.orderBy('order').first())?.id ?? null,
    [],
    undefined,
  )
}

export interface AppliedImport {
  ops: ImportOps
  goalId: ID
  /** True when the import created the goal (undo then removes it). */
  created: boolean
  /** Restores the rows as they were before the import. Does not re-plan. */
  revert: () => Promise<void>
}

/**
 * Writes the plan. For a goal target, the goal is read again inside the transaction, so the merge is
 * computed against what is in the database now, not what the preview showed a moment ago.
 * Throws when the goal has been deleted in the meantime.
 */
export async function applyPlanImport(
  plan: Plan,
  target: ImportTarget,
  today: ISODate,
): Promise<AppliedImport> {
  return db.transaction('rw', [db.goals, db.milestones, db.units], async () => {
    const existing = target.kind === 'goal' ? await loadGoalSnapshot(target.goalId) : null
    if (target.kind === 'goal' && !existing) {
      throw new Error('This goal no longer exists, so there is nothing to import into.')
    }
    const lastGoal = await db.goals.orderBy('order').last()
    const ops = planToOps(plan, existing, {
      today,
      newId,
      // Spaced like goals made by the wizard, so a later drag-reorder has room between neighbours.
      nextGoalOrder: lastGoal ? lastGoal.order + ORDER_STEP : 0,
    })

    // Snapshot what will change, before it changes.
    const oldGoal: Goal | undefined = existing?.goal
    const oldMilestones = (
      await db.milestones.bulkGet(ops.milestonesUpdate.map((u) => u.id))
    ).filter((m): m is Milestone => m !== undefined)
    const oldUnits = (await db.units.bulkGet(ops.unitsUpdate.map((u) => u.id))).filter(
      (u): u is Unit => u !== undefined,
    )

    if (ops.goalAdd) await db.goals.add(ops.goalAdd)
    if (ops.goalChanges) await db.goals.update(ops.goalId, ops.goalChanges)
    if (ops.milestonesAdd.length > 0) await db.milestones.bulkAdd(ops.milestonesAdd)
    if (ops.milestonesUpdate.length > 0) {
      await db.milestones.bulkUpdate(
        ops.milestonesUpdate.map((u) => ({ key: u.id, changes: u.changes })),
      )
    }
    if (ops.unitsAdd.length > 0) await db.units.bulkAdd(ops.unitsAdd)
    if (ops.unitsUpdate.length > 0) {
      await db.units.bulkUpdate(ops.unitsUpdate.map((u) => ({ key: u.id, changes: u.changes })))
    }
    emit({ type: 'goal.changed', goalId: ops.goalId })

    const created = ops.goalAdd !== null
    const addedMilestones = ops.milestonesAdd.map((m) => m.id)
    const addedUnits = ops.unitsAdd.map((u) => u.id)

    const revert = async (): Promise<void> => {
      await db.transaction('rw', [db.goals, db.milestones, db.units, db.tasks], async () => {
        if (created) {
          // The goal is new, so its scheduled tasks are ours. Anything the user filed under it since
          // is kept as a plain task rather than deleted.
          const tasks = await db.tasks.where('goalId').equals(ops.goalId).toArray()
          const scheduled = tasks.filter((t) => t.source === 'schedule')
          await db.tasks.bulkDelete(scheduled.map((t) => t.id))
          for (const t of tasks.filter((x) => x.source !== 'schedule')) {
            await db.tasks.update(t.id, { goalId: null, milestoneId: null, unitId: null })
          }
          await db.units.where('goalId').equals(ops.goalId).delete()
          await db.milestones.where('goalId').equals(ops.goalId).delete()
          await db.goals.delete(ops.goalId)
          for (const t of scheduled) emit({ type: 'task.deleted', taskId: t.id })
        } else {
          await db.units.bulkDelete(addedUnits)
          await db.milestones.bulkDelete(addedMilestones)
          if (oldUnits.length > 0) await db.units.bulkPut(oldUnits)
          if (oldMilestones.length > 0) await db.milestones.bulkPut(oldMilestones)
          if (oldGoal && ops.goalChanges) await db.goals.put(oldGoal)
        }
        emit({ type: 'goal.changed', goalId: ops.goalId })
      })
    }

    return { ops, goalId: ops.goalId, created, revert }
  })
}
