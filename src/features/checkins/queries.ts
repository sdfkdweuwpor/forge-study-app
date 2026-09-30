/**
 * Reads the check-in screens need, as live queries. Every hook returns `undefined` only while its first
 * query is loading.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { getCheckInForSession, listCheckIns } from '@/db/repos/checkins'
import type { CheckIn, ID } from '@/db/types'

/**
 * The check-in for one session: `null` when there is none. The result carries the id it was read for, so
 * the previous session's answer never shows for the next one.
 */
export function useCheckIn(sessionId: ID): CheckIn | null | undefined {
  const found = useLiveQuery(
    async () => ({ sessionId, checkIn: await getCheckInForSession(sessionId) }),
    [sessionId],
  )
  return found === undefined || found.sessionId !== sessionId ? undefined : found.checkIn
}

/** Every check-in, oldest first. */
export function useCheckIns(): CheckIn[] | undefined {
  return useLiveQuery(listCheckIns, [])
}
