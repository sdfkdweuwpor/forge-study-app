import { useLiveQuery } from 'dexie-react-hooks'
import { getActiveSession } from '../repos/sessions'
import type { Session } from '../types'

/**
 * The focus or break session that is running or paused: `null` when nothing is, `undefined` only
 * while the first query is loading. The row carries the timestamps the timer is computed from
 * (`@/logic/timer`); it changes on start, pause, resume and finish, never on a tick. Write through
 * `@/db/repos/sessions`.
 */
export function useActiveSession(): Session | null | undefined {
  return useLiveQuery(getActiveSession, [], undefined)
}
