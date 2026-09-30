/**
 * What the goals screens can do to a goal, course or unit, with the same feedback everywhere: a failed
 * write is recorded and shown as a toast (nothing is half-done: each repo call is one transaction), and
 * reversible ones (complete, delete) get an Undo toast.
 */
import { useMemo } from 'react'
import { recordError } from '@/app/reportError'
import {
  createMilestone,
  createUnit,
  deleteUnit,
  reorderMilestones,
  reorderUnits,
  setMilestoneStatus,
  setUnitDone,
  trashGoal,
  trashMilestone,
  updateGoal,
  updateMilestone,
  updateUnit,
  type GoalPatch,
  type MilestonePatch,
  type NewCourse,
  type UnitPatch,
} from '@/db/repos/goals'
import type { Goal, ID, Milestone, Unit } from '@/db/types'
import { courseLabel } from '@/logic/goalDisplay'
import { useToast } from '@/ui/Toast'

const shorten = (text: string, max = 48): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text

export interface GoalActions {
  updateGoal(id: ID, patch: GoalPatch): Promise<void>
  /** Moves the goal to the trash and shows an Undo toast. Resolves true when it was moved. */
  trashGoal(goal: Pick<Goal, 'id' | 'title'>): Promise<boolean>
  addCourse(goalId: ID, input: NewCourse): Promise<Milestone | null>
  updateCourse(id: ID, patch: MilestonePatch): Promise<void>
  /** Done gets an Undo toast; the other statuses just change. */
  setCourseStatus(course: Milestone, status: Milestone['status']): Promise<void>
  reorderCourses(goalId: ID, ids: readonly ID[]): Promise<void>
  trashCourse(course: Pick<Milestone, 'id' | 'code' | 'title'>): Promise<boolean>
  addUnit(courseId: ID, title: string): Promise<Unit | null>
  updateUnit(id: ID, patch: UnitPatch): Promise<void>
  setUnitDone(unit: Unit, done: boolean): Promise<void>
  reorderUnits(courseId: ID, ids: readonly ID[]): Promise<void>
  deleteUnit(unit: Pick<Unit, 'id' | 'title'>): Promise<void>
}

export function useGoalActions(): GoalActions {
  const toast = useToast()
  return useMemo<GoalActions>(() => {
    /** Runs a write; on failure records it, tells the person, and resolves with `fallback`. */
    async function attempt<T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> {
      try {
        return await run()
      } catch (error) {
        recordError(error, what)
        toast.error('Couldn’t save that', { description: 'Nothing was changed. Try again.' })
        return fallback
      }
    }
    const withUndo = (title: string, undo: () => Promise<void>): void => {
      toast.show({ title, undo })
    }

    return {
      updateGoal: (id, patch) =>
        attempt('updateGoal', async () => void (await updateGoal(id, patch)), undefined),

      trashGoal: (goal) =>
        attempt(
          'trashGoal',
          async () => {
            const result = await trashGoal(goal.id)
            if (!result) return false
            withUndo(`Moved “${shorten(goal.title)}” to the trash`, result.undo)
            return true
          },
          false,
        ),

      addCourse: (goalId, input) => attempt('addCourse', () => createMilestone(goalId, input), null),

      updateCourse: (id, patch) =>
        attempt('updateCourse', async () => void (await updateMilestone(id, patch)), undefined),

      setCourseStatus: (course, status) =>
        attempt(
          'setCourseStatus',
          async () => {
            const result = await setMilestoneStatus(course.id, status)
            if (!result) return
            if (status === 'done') {
              withUndo(`Marked ${courseLabel(course) || 'the course'} complete`, result.undo)
            } else if (course.status === 'done') {
              withUndo(`Reopened ${courseLabel(course) || 'the course'}`, result.undo)
            }
          },
          undefined,
        ),

      reorderCourses: (goalId, ids) =>
        attempt('reorderCourses', async () => void (await reorderMilestones(goalId, ids)), undefined),

      trashCourse: (course) =>
        attempt(
          'trashCourse',
          async () => {
            const result = await trashMilestone(course.id)
            if (!result) return false
            withUndo(`Moved ${shorten(courseLabel(course))} to the trash`, result.undo)
            return true
          },
          false,
        ),

      addUnit: (courseId, title) => attempt('addUnit', () => createUnit(courseId, { title }), null),

      updateUnit: (id, patch) =>
        attempt('updateUnit', async () => void (await updateUnit(id, patch)), undefined),

      setUnitDone: (unit, done) =>
        attempt('setUnitDone', async () => void (await setUnitDone(unit.id, done)), undefined),

      reorderUnits: (courseId, ids) =>
        attempt('reorderUnits', async () => void (await reorderUnits(courseId, ids)), undefined),

      deleteUnit: (unit) =>
        attempt(
          'deleteUnit',
          async () => {
            const result = await deleteUnit(unit.id)
            if (result) withUndo(`Deleted “${shorten(unit.title)}”`, result.undo)
          },
          undefined,
        ),
    }
  }, [toast])
}
