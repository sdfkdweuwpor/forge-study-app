/**
 * Which open tasks the Focus page offers to link a session to, and in what order (pure). With no query
 * the list is what you would work on next: in-progress first, then what is due today or overdue, then
 * later dates, then undated. With a query it is a fuzzy search over the title and the tags (a course
 * code such as "C779" is a tag), best match first.
 */
import type { ISODate, Task } from '@/db/types'
import { fuzzyScore } from './fuzzy'

export interface FocusTaskHit {
  task: Task
  /** UTF-16 indices in the title that matched the query, for highlighting. Empty when only a tag matched. */
  matches: number[]
}

/** A tag that matches counts a little less than the same match in the title. */
const TAG_PENALTY = 4

/** The default order: in progress, due now or overdue, due later, undated; a task skipped today goes last. */
function defaultOrder(today: ISODate): (a: Task, b: Task) => number {
  const bucket = (t: Task): number => {
    if (t.skippedOn === today) return 4
    if (t.status === 'doing') return 0
    if (t.dueDate === null) return 3
    return t.dueDate <= today ? 1 : 2
  }
  return (a, b) => {
    const byBucket = bucket(a) - bucket(b)
    if (byBucket !== 0) return byBucket
    const aDue = a.dueDate ?? '9999-12-31'
    const bDue = b.dueDate ?? '9999-12-31'
    if (aDue !== bDue) return aDue < bDue ? -1 : 1
    if (a.orderInDay !== b.orderInDay) return a.orderInDay - b.orderInDay
    return a.order - b.order
  }
}

/** Open tasks to offer, at most `limit`. Done tasks are never offered. */
export function rankFocusTasks(
  tasks: readonly Task[],
  query: string,
  today: ISODate,
  limit = 8,
): FocusTaskHit[] {
  const open = tasks.filter((t) => t.status !== 'done')
  const order = defaultOrder(today)
  const q = query.trim()

  if (q === '') {
    return [...open]
      .sort(order)
      .slice(0, limit)
      .map((task) => ({ task, matches: [] }))
  }

  const scored: { task: Task; matches: number[]; score: number }[] = []
  for (const task of open) {
    const title = fuzzyScore(q, task.title)
    let best = title ? { score: title.score, matches: title.matches } : null
    for (const tag of task.tags) {
      const hit = fuzzyScore(q, tag)
      if (hit && (best === null || hit.score - TAG_PENALTY > best.score)) {
        best = { score: hit.score - TAG_PENALTY, matches: title ? title.matches : [] }
      }
    }
    if (best) scored.push({ task, matches: best.matches, score: best.score })
  }
  scored.sort((a, b) => b.score - a.score || order(a.task, b.task))
  return scored.slice(0, limit).map(({ task, matches }) => ({ task, matches }))
}
