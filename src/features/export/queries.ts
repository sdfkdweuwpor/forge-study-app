import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import type { Goal, Milestone, PlannedAssessment, Task } from '@/db/types'

export interface ExportData {
  tasks: Task[]
  goals: Goal[]
  milestones: Milestone[]
  plannedAssessments: PlannedAssessment[]
}

/** Everything the exports read, in one consistent read. */
export async function loadExportData(): Promise<ExportData> {
  return db.transaction(
    'r',
    [db.tasks, db.goals, db.milestones, db.plannedAssessments],
    async () => ({
      tasks: await db.tasks.toArray(),
      goals: await db.goals.toArray(),
      milestones: await db.milestones.toArray(),
      plannedAssessments: await db.plannedAssessments.toArray(),
    }),
  )
}

/** Active and paused goals, for the calendar's "which goals" choice. `undefined` while loading. */
export function useExportGoals(): Pick<Goal, 'id' | 'title'>[] | undefined {
  return useLiveQuery(async () => {
    const goals = await db.goals.toArray()
    return goals
      .filter((g) => g.status !== 'archived')
      .sort((a, b) => a.order - b.order)
      .map((g) => ({ id: g.id, title: g.title }))
  })
}
