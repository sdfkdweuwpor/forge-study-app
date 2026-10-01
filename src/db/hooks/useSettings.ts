import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { valueSharer } from '@/logic/share'
import { getSettings } from '../repos/settings'
import type { Settings } from '../types'

/**
 * Live settings. `undefined` only while the first query is loading; afterwards always a complete
 * `Settings` (factory defaults if the row hasn't been created yet). Write with `updateSettings()`
 * from `@/db/repos/settings`.
 */
export function useSettings(): Settings | undefined {
  // Shared structurally: a write that changes one section (the daily run's `scheduling`, the timer)
  // leaves every other section, such as `tagColors`, the same object, so what depends on it stays put.
  const [share] = useState(valueSharer<Settings>)
  return useLiveQuery(async () => share(await getSettings()), [share])
}
