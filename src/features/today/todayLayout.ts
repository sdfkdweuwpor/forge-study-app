import { useCallback, useSyncExternalStore } from 'react'
import { PREF_KEYS, readPref, subscribePrefs, writePref } from '@/lib/localPrefs'

/** `one`: plan sessions and everyday tasks in a single time-ordered list. `grouped`: by source. */
export type TodayLayout = 'one' | 'grouped'

const read = (): TodayLayout => (readPref(PREF_KEYS.todayLayout) === 'grouped' ? 'grouped' : 'one')

/** The saved layout (device-local, default one list) and a setter that saves it. */
export function useTodayLayout(): [TodayLayout, (layout: TodayLayout) => void] {
  const layout = useSyncExternalStore(subscribePrefs, read, () => 'one' as const)
  const set = useCallback((next: TodayLayout) => writePref(PREF_KEYS.todayLayout, next), [])
  return [layout, set]
}
