/**
 * Reads only the Focus screens need. This is the one file in the feature that may import the Dexie
 * instance. Every hook returns `undefined` only while its first query is loading.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { getLastFinishedSession } from '@/db/repos/sessions'
import type { ID, ISODate, Session } from '@/db/types'

/** Every session that started on `day`, oldest first (focus and break, whatever their status). */
export function useSessionsOn(day: ISODate): Session[] | undefined {
  return useLiveQuery(() => db.sessions.where('day').equals(day).sortBy('startedAt'), [day])
}

/** The most recent session that ended: what the pomodoro cycle continues from. `null` if none. */
export function useLastFinished(): Session | null | undefined {
  return useLiveQuery(getLastFinishedSession, [], undefined)
}

/**
 * One session by id: `undefined` while loading, `null` when it does not exist. The result carries the
 * id it was read for, so a stale row from the previous id counts as loading.
 */
export function useSession(id: ID | null): Session | null | undefined {
  const found = useLiveQuery(
    async () => ({ id, session: id ? ((await db.sessions.get(id)) ?? null) : null }),
    [id],
  )
  return found === undefined || found.id !== id ? undefined : found.session
}

/** Titles of tasks by id. A task that no longer exists is missing from the map. */
export function useTaskTitles(ids: readonly ID[]): ReadonlyMap<ID, string> | undefined {
  const key = [...new Set(ids)].sort().join('|')
  return useLiveQuery(async () => {
    const wanted = key === '' ? [] : key.split('|')
    const rows = await db.tasks.bulkGet(wanted)
    const map = new Map<ID, string>()
    for (const row of rows) if (row) map.set(row.id, row.title)
    return map
  }, [key])
}

/** One session by id, read once (no subscription). */
export async function getSessionById(id: ID): Promise<Session | null> {
  return (await db.sessions.get(id)) ?? null
}

/** A task's title, read once; `null` when the task does not exist. */
export async function getTaskTitle(id: ID): Promise<string | null> {
  return (await db.tasks.get(id))?.title ?? null
}
