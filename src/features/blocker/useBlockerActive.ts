import { useConnection } from './connection'
import { useHasBlockEvents } from './queries'

/**
 * Whether the blocker has anything to show elsewhere in the app (the Today card, the Progress
 * sections): the extension is connected, or it has reported events before. `undefined` while that is
 * still being found out, so a card never flashes in and out.
 */
export function useBlockerActive(): boolean | undefined {
  const conn = useConnection()
  const hasEvents = useHasBlockEvents()
  if (conn.phase === 'connected') return true
  if (hasEvents === undefined) return undefined
  if (hasEvents) return true
  return conn.phase === 'checking' ? undefined : false
}
