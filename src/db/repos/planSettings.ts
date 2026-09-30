/**
 * Plan settings of an existing goal (the planner's "Plan settings" editor): the finish date or ASAP, the
 * study windows and shift pattern, the session length, the blackout dates, the buffer and the hours per
 * CU. One transaction writes the goal (and the estimates a new multiplier changes), then the goal is
 * re-planned with `rebalanceGoal(reason: 'edit')`.
 */
import { rescaleCuEstimates } from '@/logic/plannerEffort'
import { db } from '../db'
import { emit } from '../events'
import type { Availability, Goal, GoalPlanning, ID, ISODate } from '../types'
import { rebalanceGoal, type RebalanceSummary } from './goals'
import type { RepoOptions } from './tasks'

export interface PlanSettingsInput {
  /** `null` with `asap` = as fast as possible. */
  targetDate: ISODate | null
  asap: boolean
  availability: Availability
  planning: Pick<GoalPlanning, 'sessionMinutes' | 'weekly' | 'shiftPattern'>
  bufferPct: number
  cuHoursMultiplier: number
}

export interface SavedPlanSettings {
  goal: Goal
  /** The re-plan; `null` when it could not run (the settings are saved). */
  summary: RebalanceSummary | null
  planError: unknown
}

/** Saves the settings and re-plans. `null` for a missing goal. */
export async function savePlanSettings(
  goalId: ID,
  input: PlanSettingsInput,
  opts: RepoOptions = {},
): Promise<SavedPlanSettings | null> {
  const now = opts.now ?? Date.now()
  const saved = await db.transaction('rw', [db.goals, db.milestones, db.units], async () => {
    const before = await db.goals.get(goalId)
    if (!before) return null
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
          await db.milestones.update(course.id, { estimateHours: r.estimateHours, updatedAt: now })
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
    return { ...before, ...changes } as Goal
  })
  if (saved === null) return null
  try {
    const summary = await rebalanceGoal(goalId, { now, reason: 'edit' })
    return { goal: (await db.goals.get(goalId)) ?? saved, summary, planError: null }
  } catch (error) {
    return { goal: saved, summary: null, planError: error }
  }
}
