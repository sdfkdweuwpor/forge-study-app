/**
 * Reads for the resource library. This is the one file in the feature that may import the Dexie instance.
 * `useCourseResources` returns `undefined` only while its first query is loading (a failed read is thrown to
 * the panel's error boundary, as every live query is).
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { listFileMeta, type FileMeta } from '@/db/repos/files'
import { listResources } from '@/db/repos/resources'
import type { ID, Resource } from '@/db/types'
import { fuzzyFilter } from '@/logic/fuzzy'
import { courseLabel } from '@/logic/goalDisplay'

/** A resource with what its row needs to know about its file. */
export interface ResourceView extends Resource {
  /** Name, type and size of the stored PDF; `null` for links, notes and a PDF whose file is gone. */
  file: FileMeta | null
  /** A PDF whose file is not on this device (a backup without its bytes, a snapshot restore). */
  fileMissing: boolean
}

/** A course's resources in their manual order, with each PDF's size. */
export function useCourseResources(courseId: ID): ResourceView[] | undefined {
  const found = useLiveQuery(async () => {
    const rows = await listResources(courseId)
    const ids = rows.flatMap((r) => (r.fileId === null ? [] : [r.fileId]))
    const files = new Map((await listFileMeta(ids)).map((f) => [f.id, f]))
    const items = rows.map((r): ResourceView => {
      const file = r.fileId === null ? null : (files.get(r.fileId) ?? null)
      return { ...r, file, fileMissing: r.kind === 'pdf' && file === null }
    })
    return { courseId, items }
  }, [courseId])
  return found === undefined || found.courseId !== courseId ? undefined : found.items
}

export interface ResourceHit {
  resource: Resource
  /** "C779 Web Development Foundations". */
  course: string
  goalId: ID
  courseId: ID
}

/** Palette search: resources whose title matches, best first, with the course each lives in. */
export async function searchResources(query: string, limit: number): Promise<ResourceHit[]> {
  if (query.trim() === '' || limit <= 0) return []
  const rows = await db.resources.toArray()
  const ranked = fuzzyFilter(rows, query, (r) => r.title, limit * 2)
  const courseIds = [...new Set(ranked.map((r) => r.item.milestoneId))]
  const courses = new Map(
    (await db.milestones.bulkGet(courseIds)).flatMap((c) => (c ? [[c.id, c] as const] : [])),
  )
  const hits: ResourceHit[] = []
  for (const { item } of ranked) {
    const course = courses.get(item.milestoneId)
    if (!course) continue // an orphan (its course is gone): nowhere to open it
    hits.push({
      resource: item,
      course: courseLabel(course),
      goalId: course.goalId,
      courseId: course.id,
    })
    if (hits.length >= limit) break
  }
  return hits
}
