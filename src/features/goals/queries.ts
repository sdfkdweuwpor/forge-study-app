/**
 * Reads for the goals screens. This is the one file in the feature that may import the Dexie instance.
 * Every hook returns `undefined` only while its first query is loading; the single-goal and
 * single-course hooks return `null` for a row that does not exist (deleted, or a stale link).
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '@/db/db'
import type { Cover, Goal, ID, Milestone, Task, Unit } from '@/db/types'
import { fuzzyFilter } from '@/logic/fuzzy'
import { courseLabel, sortCourses } from '@/logic/goalDisplay'
import { goalWork, type CourseWork, type GoalWork } from '@/logic/scheduler'

// ─── The goals list ─────────────────────────────────────────────────────────

export interface GoalOverview {
  goal: Goal
  /** In course order. */
  courses: Milestone[]
  work: GoalWork
}

async function loadOverviews(): Promise<GoalOverview[]> {
  const goals = (await db.goals.toArray()).sort(
    (a, b) => a.order - b.order || a.createdAt - b.createdAt,
  )
  return Promise.all(
    goals.map(async (goal) => {
      const [courses, units, tasks] = await Promise.all([
        db.milestones.where('goalId').equals(goal.id).toArray(),
        db.units.where('goalId').equals(goal.id).toArray(),
        db.tasks.where('goalId').equals(goal.id).toArray(),
      ])
      return {
        goal,
        courses: sortCourses(courses),
        work: goalWork({ milestones: courses, units, tasks }),
      }
    }),
  )
}

/** Every goal with its courses and hours done, in goal order. */
export function useGoalOverviews(): GoalOverview[] | undefined {
  return useLiveQuery(loadOverviews)
}

// ─── One goal ───────────────────────────────────────────────────────────────

export interface GoalData {
  goal: Goal
  courses: Milestone[]
  units: Unit[]
  work: GoalWork
}

/**
 * A goal with its courses, units and hours done. `undefined` while loading, `null` when it does not
 * exist. When `id` changes the previous goal is never returned for the new id: it counts as loading.
 */
export function useGoalData(id: ID | undefined): GoalData | null | undefined {
  const found = useLiveQuery(async () => {
    const goal = id ? await db.goals.get(id) : undefined
    if (!goal || !id) return { id, data: null }
    const [courses, units, tasks] = await Promise.all([
      db.milestones.where('goalId').equals(id).toArray(),
      db.units.where('goalId').equals(id).toArray(),
      db.tasks.where('goalId').equals(id).toArray(),
    ])
    const data: GoalData = {
      goal,
      courses: sortCourses(courses),
      units,
      work: goalWork({ milestones: courses, units, tasks }),
    }
    return { id, data }
  }, [id])
  return found === undefined || found.id !== id ? undefined : found.data
}

// ─── One course ─────────────────────────────────────────────────────────────

export interface CourseData {
  goal: Goal
  course: Milestone
  /** In unit order. */
  units: Unit[]
  /** The course's tasks (scheduled study and any the person filed under it), by date. */
  tasks: Task[]
  /** Hours done and left; `undefined` only if the course has no row in the plan. */
  work: CourseWork | undefined
  /** The goal's other courses, for the prerequisite picker. */
  siblings: Milestone[]
}

export function useCourseData(
  goalId: ID | undefined,
  courseId: ID | undefined,
): CourseData | null | undefined {
  const key = `${goalId ?? ''}/${courseId ?? ''}`
  const found = useLiveQuery(async () => {
    const [goal, course] = await Promise.all([
      goalId ? db.goals.get(goalId) : undefined,
      courseId ? db.milestones.get(courseId) : undefined,
    ])
    if (!goal || !course || course.goalId !== goal.id) return { key, data: null }
    const [siblings, allUnits, goalTasks] = await Promise.all([
      db.milestones.where('goalId').equals(goal.id).toArray(),
      db.units.where('goalId').equals(goal.id).toArray(),
      db.tasks.where('goalId').equals(goal.id).toArray(),
    ])
    const work = goalWork({ milestones: siblings, units: allUnits, tasks: goalTasks })
    const tasks = goalTasks
      .filter((t) => t.milestoneId === course.id)
      .sort(
        (a, b) =>
          (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
          a.orderInDay - b.orderInDay ||
          a.order - b.order,
      )
    const data: CourseData = {
      goal,
      course,
      units: allUnits
        .filter((u) => u.milestoneId === course.id)
        .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
      tasks,
      work: work.courses.find((c) => c.courseId === course.id),
      siblings: sortCourses(siblings).filter((m) => m.id !== course.id),
    }
    return { key, data }
  }, [key])
  return found === undefined || found.key !== key ? undefined : found.data
}

// ─── The tree (sidebar, palette) ────────────────────────────────────────────

export interface GoalNode {
  goal: Pick<Goal, 'id' | 'title' | 'icon' | 'status'>
  courses: Array<Pick<Milestone, 'id' | 'code' | 'title' | 'status'>>
}

async function loadTree(): Promise<GoalNode[]> {
  const [goals, milestones] = await Promise.all([db.goals.toArray(), db.milestones.toArray()])
  goals.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  return goals
    .filter((g) => g.status !== 'archived')
    .map((g) => ({
      goal: { id: g.id, title: g.title, icon: g.icon, status: g.status },
      courses: sortCourses(milestones.filter((m) => m.goalId === g.id)).map((m) => ({
        id: m.id,
        code: m.code,
        title: m.title,
        status: m.status,
      })),
    }))
}

/** Goals and their courses in order, for the sidebar tree. */
export function useGoalTree(): GoalNode[] | undefined {
  return useLiveQuery(loadTree)
}

export interface GoalHit {
  kind: 'goal' | 'course'
  goalId: ID
  courseId: ID | null
  title: string
  subtitle: string
}

/** Palette search over goal titles and course titles and codes (fuzzy). An empty query finds nothing. */
export async function searchGoals(query: string, limit: number): Promise<GoalHit[]> {
  if (query.trim() === '' || limit <= 0) return []
  const tree = await loadTree()
  const goalTitle = new Map(tree.map((n) => [n.goal.id, n.goal.title]))
  const hits: GoalHit[] = []
  for (const node of tree) {
    hits.push({
      kind: 'goal',
      goalId: node.goal.id,
      courseId: null,
      title: node.goal.title,
      subtitle: 'Goal',
    })
    for (const c of node.courses) {
      hits.push({
        kind: 'course',
        goalId: node.goal.id,
        courseId: c.id,
        title: courseLabel(c),
        subtitle: goalTitle.get(node.goal.id) ?? 'Course',
      })
    }
  }
  return fuzzyFilter(hits, query, (h) => h.title, limit).map((r) => r.item)
}

// ─── Covers ─────────────────────────────────────────────────────────────────

export type PageCoverValue =
  { kind: 'gradient'; preset: string } | { kind: 'image'; url: string; posY?: number }

/**
 * A stored cover as the page header wants it. A gradient passes straight through; an image cover
 * (from an imported backup) is turned into an object URL for as long as the page shows it, and
 * dropped (no cover) while its file loads or if it is missing.
 */
export function useCoverValue(cover: Cover | null): PageCoverValue | null {
  const fileId = cover?.kind === 'image' ? cover.fileId : null
  const [url, setUrl] = useState<{ fileId: ID; url: string } | null>(null)

  useEffect(() => {
    if (fileId === null) return undefined
    let cancelled = false
    let made: string | null = null
    void db.files.get(fileId).then((file) => {
      if (cancelled || !file) return
      made = URL.createObjectURL(file.blob)
      setUrl({ fileId, url: made })
    })
    return () => {
      cancelled = true
      if (made !== null) URL.revokeObjectURL(made)
    }
  }, [fileId])

  if (cover === null) return null
  if (cover.kind === 'gradient') return cover
  return url !== null && url.fileId === cover.fileId
    ? { kind: 'image', url: url.url, posY: cover.posY }
    : null
}
