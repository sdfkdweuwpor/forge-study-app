import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { ID, ISODate, Task } from '../types'

/**
 * Live task reads. Every hook returns `undefined` only while its first query is loading, so callers can
 * tell "loading" from "empty". Write through `@/db/repos/tasks`. Sorting, filtering and grouping are
 * `@/logic/taskQuery`'s job; these just hand over the rows.
 */

/** Every task, open and done. Fine for a personal list (thousands of rows); sort it with `taskQuery`. */
export function useTasks(): Task[] | undefined {
  return useLiveQuery(() => db.tasks.toArray())
}

/** Tasks that are todo or doing (uses the `status` index). */
export function useOpenTasks(): Task[] | undefined {
  return useLiveQuery(() => db.tasks.where('status').anyOf('todo', 'doing').toArray())
}

/** Finished tasks, latest first. Pass `limit` to keep only the most recent ones. */
export function useCompletedTasks(limit?: number): Task[] | undefined {
  return useLiveQuery(async () => {
    const done = await db.tasks.where('status').equals('done').toArray()
    done.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    return limit === undefined ? done : done.slice(0, limit)
  }, [limit])
}

/** Tasks due from `from` to `to`, inclusive (uses the `dueDate` index); undated tasks are not included. */
export function useTasksDueBetween(from: ISODate, to: ISODate): Task[] | undefined {
  return useLiveQuery(
    () => db.tasks.where('dueDate').between(from, to, true, true).toArray(),
    [from, to],
  )
}

/** One task: `undefined` while loading, `null` when it does not exist (deleted, or a bad link). */
export function useTask(id: ID | undefined): Task | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.tasks.get(id)) ?? null) : null), [id])
}
