/**
 * Reads that only the tasks feature needs: the goals and courses tasks can be filed under, the tags in
 * use, and palette search. This is the one file in the feature that may import the Dexie instance.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { proposeAutoSlots } from '@/db/repos/autoslot'
import type { ID } from '@/db/types'
import type { AutoSlotProposal } from '@/logic/everydaySlots'
import { normalizeTag } from '@/logic/tagColor'
import { searchTasksIn, type TaskHit } from '@/logic/taskSearch'
import type { ProjectRef } from '@/logic/taskQuery'

export interface GoalInfo {
  id: ID
  title: string
  icon: string
}

export interface CourseInfo {
  id: ID
  goalId: ID
  /** "C779", or null for a milestone without a code. */
  code: string | null
  title: string
  /** "C779 Web Development Foundations". */
  label: string
}

export interface ProjectIndex {
  goals: readonly GoalInfo[]
  /** In goal order, then course order. */
  courses: readonly CourseInfo[]
  goalById: ReadonlyMap<ID, GoalInfo>
  courseById: ReadonlyMap<ID, CourseInfo>
}

async function loadProjectIndex(): Promise<ProjectIndex> {
  const [goals, milestones] = await Promise.all([
    db.goals.orderBy('order').toArray(),
    db.milestones.toArray(),
  ])
  const goalOrder = new Map(goals.map((g, i) => [g.id, i]))
  const courses = milestones
    .filter((m) => goalOrder.has(m.goalId))
    .sort(
      (a, b) =>
        (goalOrder.get(a.goalId) ?? 0) - (goalOrder.get(b.goalId) ?? 0) ||
        a.order - b.order ||
        a.createdAt - b.createdAt,
    )
    .map<CourseInfo>((m) => ({
      id: m.id,
      goalId: m.goalId,
      code: m.code,
      title: m.title,
      label: [m.code, m.title].filter(Boolean).join(' '),
    }))
  const goalInfos = goals.map<GoalInfo>((g) => ({ id: g.id, title: g.title, icon: g.icon }))
  return {
    goals: goalInfos,
    courses,
    goalById: new Map(goalInfos.map((g) => [g.id, g])),
    courseById: new Map(courses.map((c) => [c.id, c])),
  }
}

/** Live goals and their courses, for the "Goal / course" picker, course chips and grouping by project. */
export function useProjectIndex(): ProjectIndex | undefined {
  return useLiveQuery(loadProjectIndex)
}

/** The projects a list can be grouped by, in display order: each goal, then its courses. */
export function projectRefsOf(index: ProjectIndex): ProjectRef[] {
  return index.goals.flatMap<ProjectRef>((goal) => [
    { id: goal.id, kind: 'goal', label: goal.title },
    ...index.courses
      .filter((c) => c.goalId === goal.id)
      .map<ProjectRef>((c) => ({ id: c.id, kind: 'milestone', label: c.label })),
  ])
}

/** Every distinct tag on any task, alphabetically, keeping the first spelling seen. */
export function useTagList(): string[] | undefined {
  return useLiveQuery(async () => {
    const seen = new Map<string, string>()
    await db.tasks.each((task) => {
      for (const tag of task.tags) {
        const key = normalizeTag(tag)
        if (!seen.has(key)) seen.set(key, tag)
      }
    })
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
  })
}

/**
 * Palette search over titles (fuzzy) and, more loosely, notes, checklist items and tags (substring).
 * Open tasks rank above finished ones with the same score. An empty query finds nothing.
 */
export async function searchTasks(query: string, limit: number): Promise<TaskHit[]> {
  if (query.trim() === '' || limit <= 0) return []
  return searchTasksIn(await db.tasks.toArray(), query, limit)
}

/** XP a task has earned so far (its award minus any reversal), or `undefined` while loading. */
export function useTaskXp(taskId: ID): number | undefined {
  return useLiveQuery(async () => {
    const events = await db.xpEvents.where('key').equals(`task:${taskId}`).toArray()
    return events.reduce((sum, e) => sum + e.amount, 0)
  }, [taskId])
}

/** XP each finished task earned, by task id. Only loaded when `enabled` (the Completed list shows it). */
export function useTaskXpMap(enabled: boolean): ReadonlyMap<ID, number> | undefined {
  return useLiveQuery(async () => {
    const map = new Map<ID, number>()
    if (!enabled) return map
    const events = await db.xpEvents.where('source').equals('task').toArray()
    for (const e of events) if (e.refId) map.set(e.refId, (map.get(e.refId) ?? 0) + e.amount)
    return map
  }, [enabled])
}

export type AutoSlotState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; proposal: AutoSlotProposal }

type AutoSlotRead = { ok: true; proposal: AutoSlotProposal } | { ok: false }

/**
 * Live suggested times for opted-in tasks (recomputed when tasks or settings change, and every minute,
 * since a slot in the past is no use). Never throws: a failing read is an `error` state with a retry.
 */
export function useAutoSlotProposal(minute: number, attempt = 0): AutoSlotState {
  const read = useLiveQuery<AutoSlotRead>(async () => {
    try {
      return { ok: true, proposal: await proposeAutoSlots({ now: minute }) }
    } catch {
      return { ok: false }
    }
  }, [minute, attempt])
  if (read === undefined) return { status: 'loading' }
  return read.ok ? { status: 'ready', proposal: read.proposal } : { status: 'error' }
}
