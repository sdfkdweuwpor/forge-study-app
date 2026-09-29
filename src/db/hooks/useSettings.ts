import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '../repos/settings'
import type { Settings } from '../types'

/**
 * Live settings. `undefined` only while the first query is loading; afterwards always a complete
 * `Settings` (factory defaults if the row hasn't been created yet). Write with `updateSettings()`
 * from `@/db/repos/settings`.
 */
export function useSettings(): Settings | undefined {
  return useLiveQuery(getSettings)
}
