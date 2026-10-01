/**
 * Plan settings of an existing goal (the planner's "Plan settings" editor): the finish date or ASAP, the
 * study windows and shift pattern, the session length, the blackout dates, the buffer and the hours per
 * CU. One transaction writes the goal (and the estimates a new multiplier changes), then the goal is
 * re-planned with `rebalanceGoal(reason: 'edit')`. The goal, its courses, units and plan tasks are
 * snapshotted first, the way `applyProposal` does, so `undo()` puts the old settings and plan back.
 */
import { rescaleCuEstimates } from '@/logic/plannerEffort'
import { db } from '../db'
import { emit } from '../events'
import type { Availability, Goal, GoalPlanning, ID, ISODate } from '../types'
import { rebalanceGoal, type RebalanceSummary } from './goals'
import { restoreSnapshot, snapshotGoalPlan, type Snapshot } from './proposals'
import type { RepoOptions, Undoable } from './tasks'

export interface PlanSettingsInput {
  /** `null` with `asap` = as fast as possible. */
  targetDate: ISODate | null
  asap: boolean
  availability: Availability
  planning: Pick<GoalPlanning, 'sessionMinutes' | 'weekly' | 'shiftPattern'>
  bufferPct: number
  cuHoursMultiplier: number
}

export interface SavedPlanSettings extends Undoable {
  goal: Goal
  /** The re-plan; `null` when it could not run (the settings are saved). */
  summary: RebalanceSummary | null
  planError: unknown
}

/** Saves the settings and re-plans; `undo()` restores the previous settings and plan. `null` for a missing goal. */
export async function savePlanSettings(
  goalId: ID,
  input: PlanSettingsInput,
  opts: RepoOptions = {},
): Promise<SavedPlanSettings | null> {
  const now = opts.now ?? Date.now()
  const written = await db.transaction(
    'rw',
    [db.goals, db.milestones, db.units, db.tasks],
    async () => {
      const before = await db.goals.get(goalId)
      if (!before) return null
      const snap: Snapshot = snapshotGoalPlan(before, {
        units: await db.units.where('goalId').equals(goalId).toArray(),
        milestones: await db.milestones.where('goalId').equals(goalId).toArray(),
        tasks: await db.tasks.where('goalId').equals(goalId).toArray(),
      })
      const oldMultiplier = before.planning.cuHoursMultiplier
      const planning: GoalPlanning = {
        ...before.planning,
        ...input.planning,
        bufferPct: input.bufferPct,
        cuHoursMultiplier: input.cuHoursMultiplier,
        asap: input.asap || input.targetDate === null,
        paceMinutesPerStudyDay: null,
      }
      const changes: Partial<Goal> = {
        targetDate: input.asap ? null : input.targetDate,
        availability: input.availability,
        planning,
        updatedAt: now,
      }
      await db.goals.update(goalId, changes)

      if (oldMultiplier !== input.cuHoursMultiplier) {
        const courses = await db.milestones.where('goalId').equals(goalId).toArray()
        const units = await db.units.where('goalId').equals(goalId).toArray()
        for (const course of courses) {
          const own = units.filter((u) => u.milestoneId === course.id)
          const r = rescaleCuEstimates(course, own, oldMultiplier, input.cuHoursMultiplier)
          if (!r) continue
          if (r.estimateHours !== null) {
            await db.milestones.update(course.id, {
              estimateHours: r.estimateHours,
              updatedAt: now,
            })
          }
          for (const u of r.units) {
            await db.units.update(u.id, {
              estimateMinutes: u.estimateMinutes,
              baseEstimateMinutes: u.baseEstimateMinutes,
              updatedAt: now,
            })
          }
        }
      }
      emit({ type: 'goal.changed', goalId })
      return { saved: { ...before, ...changes } as Goal, snap }
    },
  )
  if (written === null) return null
  const { saved, snap } = written
  const undo = () => restoreSnapshot(snap)
  try {
    const summary = await rebalanceGoal(goalId, { now, reason: 'edit' })
    return { goal: (await db.goals.get(goalId)) ?? saved, summary, planError: null, undo }
  } catch (error) {
    return { goal: saved, summary: null, planError: error, undo }
  }
}
