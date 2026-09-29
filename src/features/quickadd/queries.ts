import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import type { ID } from '@/db/types'

/** A course (milestone with a code such as C182): what `#C182` in the input links the task to. */
export interface QuickAddCourse {
  id: ID
  goalId: ID
  code: string
  title: string
}

export interface CourseState {
  courses: readonly QuickAddCourse[]
  /** The first read has not finished; typing still works, `#C182` just is not linked yet. */
  loading: boolean
  /** Reading courses failed; the task is created without a course link. */
  failed: boolean
}

type Read = { ok: true; courses: QuickAddCourse[] } | { ok: false }

const NONE: readonly QuickAddCourse[] = []

/** Live list of coded courses. Never throws: a failing read only costs the course link. */
export function useCourses(): CourseState {
  const read = useLiveQuery<Read>(async () => {
    try {
      const rows = await db.milestones.toArray()
      const courses = rows.flatMap((m) =>
        m.code !== null && m.code.trim() !== ''
          ? [{ id: m.id, goalId: m.goalId, code: m.code.trim(), title: m.title }]
          : [],
      )
      return { ok: true, courses }
    } catch {
      return { ok: false }
    }
  }, [])
  if (read === undefined) return { courses: NONE, loading: true, failed: false }
  return read.ok
    ? { courses: read.courses, loading: false, failed: false }
    : { courses: NONE, loading: false, failed: true }
}
