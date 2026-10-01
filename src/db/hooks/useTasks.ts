import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { rowSharer } from '@/logic/share'
import { db } from '../db'
import type { ID, ISODate, Task } from '../types'

/**
 * Live task reads. Every hook returns `undefined` only while its first query is loading, so callers can
 * tell "loading" from "empty". Write through `@/db/repos/tasks`. Sorting, filtering and grouping are
 * `@/logic/taskQuery`'s job; these just hand over the rows.
 *
 * The lists are structurally shared (`rowSharer`): a re-run keeps every unchanged task object, and
 * returns the previous array itself when nothing changed. Any write to `tasks` re-runs these queries, so
 * without it one finished task handed every row of a 2,000-row list a new identity and re-rendered it.
 */

/** Every task, open and done. Fine for a personal list (thousands of rows); sort it with `taskQuery`. */
export function useTasks(): Task[] | undefined {
  const [share] = useState(rowSharer<Task>)
  return useLiveQuery(async () => share(await db.tasks.toArray()), [share])
}

/**
 * Tasks that are todo or doing (uses the `status` index). Two `equals` reads rather than `anyOf`:
 * Dexie serves `anyOf` with a cursor, one IndexedDB round trip per row, which with a few hundred open
 * tasks held up every other read at app start by a third of a second; `equals` is one `getAll`.
 */
/** Every `todo` and `doing` task, read once (`useOpenTasks` is the live version). */
export async function readOpenTasks(): Promise<Task[]> {
  const [todo, doing] = await Promise.all([
    db.tasks.where('status').equals('todo').toArray(),
    db.tasks.where('status').equals('doing').toArray(),
  ])
  return [...todo, ...doing]
}

export function useOpenTasks(): Task[] | undefined {
  const [share] = useState(rowSharer<Task>)
  return useLiveQuery(async () => share(await readOpenTasks()), [share])
}

/** Finished tasks, latest first. Pass `limit` to keep only the most recent ones. */
export function useCompletedTasks(limit?: number): Task[] | undefined {
  const [share] = useState(rowSharer<Task>)
  return useLiveQuery(async () => {
    const done = await db.tasks.where('status').equals('done').toArray()
    done.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    return share(limit === undefined ? done : done.slice(0, limit))
  }, [limit, share])
}

/**
 * Tasks planned from `from` to `to`, inclusive: by their do date, or by their deadline when they have
 * no do date (`planDay`). Uses the `doDate` and `dueDate` indexes; undated tasks are not included.
 */
export function useTasksPlannedBetween(from: ISODate, to: ISODate): Task[] | undefined {
  const [share] = useState(rowSharer<Task>)
  return useLiveQuery(async () => {
    const [planned, due] = await Promise.all([
      db.tasks.where('doDate').between(from, to, true, true).toArray(),
      db.tasks.where('dueDate').between(from, to, true, true).toArray(),
    ])
    return share([...planned, ...due.filter((t) => t.doDate === null)])
  }, [from, to, share])
}

/**
 * One task: `undefined` while loading, `null` when it does not exist (deleted, or a bad link).
 * When `id` changes, the live query keeps returning the previous task until the new one arrives; the
 * result carries the id it was read for, so that stale row counts as loading, never as the new task.
 */
export function useTask(id: ID | undefined): Task | null | undefined {
  const found = useLiveQuery(
    async () => ({ id, task: id ? ((await db.tasks.get(id)) ?? null) : null }),
    [id],
  )
  return found === undefined || found.id !== id ? undefined : found.task
}
