/**
 * Reads the blocker screens need, as live queries. This is the one file in the feature that may import
 * the Dexie instance. Every hook returns `undefined` only while its first query is loading.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { countMissingDefaults, getBlockerConfig, listBlocklist } from '@/db/repos/blocker'
import { getActiveSession } from '@/db/repos/sessions'
import { getSettings } from '@/db/repos/settings'
import type { BlockEvent, BlocklistEntry, ISODate, Settings } from '@/db/types'
import { addDays } from '@/logic/dates'
import { toSessionState } from '@/logic/blocker'
import type { BlockerConfig, SessionState } from '@ext/protocol'

/** Every blocklist row: blocked sites, then exceptions. */
export function useBlocklist(): BlocklistEntry[] | undefined {
  return useLiveQuery(listBlocklist, [])
}

/** How many default sites are missing from the list ("Restore defaults (3)"). */
export function useMissingDefaults(): number | undefined {
  return useLiveQuery(countMissingDefaults, [])
}

/** The blocker settings, live. */
export function useBlockerSettings(): Settings['blocker'] | undefined {
  return useLiveQuery(async () => (await getSettings()).blocker, [])
}

/**
 * The config to push to the extension, or `undefined` until the default list has been added (so an
 * empty first list is never sent).
 */
export function useBlockerConfig(): BlockerConfig | undefined {
  return useLiveQuery(async () => {
    if (!(await getSettings()).blocker.blocklistSeeded) return undefined
    return getBlockerConfig()
  }, [])
}

/**
 * The focus session as the extension needs it: `undefined` while loading, `null` when nothing is being
 * focused on. Reads the running session and its task's title; it changes on start, pause, resume and
 * end, never on a tick.
 */
export function useSessionState(): SessionState | null | undefined {
  return useLiveQuery(
    async () => {
      const session = await getActiveSession()
      const task = session?.taskId ? await db.tasks.get(session.taskId) : undefined
      return toSessionState(session, task?.title ?? null)
    },
    [],
    undefined,
  )
}

/** Blocked attempts and unlocks since `from` (a day), oldest first. Pass `null` for all of them. */
export function useBlockEvents(from: ISODate | null): BlockEvent[] | undefined {
  return useLiveQuery(
    () =>
      from === null
        ? db.blockEvents.orderBy('at').toArray()
        : db.blockEvents.where('day').aboveOrEqual(from).sortBy('at'),
    [from],
  )
}

/** Events over the last `days` days, today included. */
export function useRecentBlockEvents(today: ISODate, days: number): BlockEvent[] | undefined {
  return useBlockEvents(addDays(today, -(days - 1)))
}

/** Whether the extension has ever reported anything (attempts or unlocks). */
export function useHasBlockEvents(): boolean | undefined {
  return useLiveQuery(async () => (await db.blockEvents.count()) > 0, [])
}

/** Every emergency unlock, oldest first. */
export function useUnlockEvents(): BlockEvent[] | undefined {
  return useLiveQuery(() => db.blockEvents.where('kind').equals('unlock').sortBy('at'), [])
}
