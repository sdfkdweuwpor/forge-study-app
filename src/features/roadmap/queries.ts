/**
 * Reads for the Roadmap. The one file in the feature that may import the Dexie instance. The hook
 * returns `undefined` only while the first query is loading.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { goalWork } from '@/logic/scheduler'
import { percent, sortCourses } from '@/logic/goalDisplay'
import type { RoadmapGoal } from '@/logic/roadmap'
import type { GoalProjection, Goal } from '@/db/types'

/** What a lane needs besides its layout: the goal's own words about its finish. */
export interface RoadmapEntry {
  goal: Pick<Goal, 'id' | 'status' | 'targetDate'> & { projection: GoalProjection | null }
  input: RoadmapGoal
}

/** Active goals in list order, each with its courses, assessments, weekly milestones and % complete. */
export function useRoadmapGoals(): RoadmapEntry[] | undefined {
  return useLiveQuery(async () => {
    const goals = (await db.goals.where('status').equals('active').toArray()).sort(
      (a, b) => a.order - b.order || a.createdAt - b.createdAt,
    )
    return Promise.all(
      goals.map(async (goal): Promise<RoadmapEntry> => {
        const [courses, units, tasks, assessments] = await Promise.all([
          db.milestones.where('goalId').equals(goal.id).toArray(),
          db.units.where('goalId').equals(goal.id).toArray(),
          db.tasks.where('goalId').equals(goal.id).toArray(),
          db.plannedAssessments.where('goalId').equals(goal.id).toArray(),
        ])
        const work = goalWork({ milestones: courses, units, tasks })
        const minutes = new Map(work.courses.map((c) => [c.courseId, c.totalMinutes]))
        const sorted = sortCourses(courses)
        const codes = new Map(courses.map((c) => [c.id, c.code ?? c.title]))
        return {
          goal: {
            id: goal.id,
            status: goal.status,
            targetDate: goal.targetDate,
            projection: goal.projection,
          },
          input: {
            id: goal.id,
            title: goal.title,
            icon: goal.icon,
            startDate: goal.startDate,
            targetDate: goal.targetDate,
            projectedEnd: goal.projection?.end ?? null,
            percent: percent(work.doneMinutes, work.totalMinutes),
            courses: sorted.map((c) => ({
              id: c.id,
              code: c.code,
              title: c.title,
              status: c.status,
              start: c.projectedStart,
              end: c.projectedEnd,
              hours: Math.round(((minutes.get(c.id) ?? c.estimateHours * 60) / 60) * 10) / 10,
            })),
            assessments: assessments
              .filter((a) => a.status !== 'skipped')
              .map((a) => ({
                id: a.id,
                kind: a.kind,
                title:
                  a.milestoneId !== null && codes.has(a.milestoneId)
                    ? `${codes.get(a.milestoneId)} · ${a.title}`
                    : a.title,
                date: a.date,
                done: a.status === 'done',
              })),
            weekly: tasks
              .filter((t) => t.kind === 'milestone' && t.doDate !== null)
              .map((t) => ({ id: t.id, title: t.title, date: t.doDate as string })),
          },
        }
      }),
    )
  })
}
