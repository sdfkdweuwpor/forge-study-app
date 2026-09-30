/**
 * Reads the parking screens need, as live queries. Every hook returns `undefined` only while its first
 * query is loading.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { listParkingItems } from '@/db/repos/parking'
import type { ID, ParkingItem } from '@/db/types'

/** Every thought still waiting, oldest first. */
export function useOpenParked(): ParkingItem[] | undefined {
  return useLiveQuery(() => listParkingItems({ status: 'open' }), [])
}

/**
 * The thoughts parked in one session, whatever became of them (the dialog lists the open ones and knows,
 * from the rest, whether there was anything to sort). The result carries the id it was read for, so a stale
 * list from the previous session counts as loading.
 */
export function useParkedInSession(sessionId: ID): ParkingItem[] | undefined {
  const found = useLiveQuery(
    async () => ({ sessionId, items: await listParkingItems({ sessionId }) }),
    [sessionId],
  )
  return found === undefined || found.sessionId !== sessionId ? undefined : found.items
}
