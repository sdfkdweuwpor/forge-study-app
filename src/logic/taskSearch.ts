/**
 * Palette search over tasks (pure): fuzzy on titles, plain substring on checklist items, tags and
 * notes. A title match always outranks the others; open tasks outrank finished ones at equal score.
 */
import type { Task } from '@/db/types'
import { toPlainText } from './blocks'
import { fuzzyScore } from './fuzzy'

export interface TaskHit {
  task: Task
  score: number
  /** Where it matched, for the palette subtitle. */
  in: 'title' | 'notes' | 'subtask' | 'tag'
}

const TITLE = 1000
const SUBTASK = 200
const TAG = 150
const NOTES = 100
const OPEN_BONUS = 5

function hitFor(task: Task, query: string, lower: string): TaskHit | null {
  const title = fuzzyScore(query, task.title)
  if (title) return { task, score: TITLE + title.score, in: 'title' }
  if (task.subtasks.some((s) => s.title.toLowerCase().includes(lower))) {
    return { task, score: SUBTASK, in: 'subtask' }
  }
  if (task.tags.some((t) => t.toLowerCase().includes(lower))) return { task, score: TAG, in: 'tag' }
  if (toPlainText(task.notes).toLowerCase().includes(lower))
    return { task, score: NOTES, in: 'notes' }
  return null
}

/** The best `limit` matches for `query`, best first. An empty query finds nothing. */
export function searchTasksIn(tasks: readonly Task[], query: string, limit: number): TaskHit[] {
  const q = query.trim()
  if (q === '' || !(limit > 0)) return []
  const lower = q.toLowerCase()
  const hits: TaskHit[] = []
  for (const task of tasks) {
    const hit = hitFor(task, q, lower)
    if (!hit) continue
    if (task.status !== 'done') hit.score += OPEN_BONUS
    hits.push(hit)
  }
  hits.sort((a, b) => b.score - a.score || a.task.title.length - b.task.title.length)
  return hits.slice(0, limit)
}
