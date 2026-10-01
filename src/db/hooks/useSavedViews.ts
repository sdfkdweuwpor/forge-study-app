import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { ID, SavedView } from '../types'

/** Every saved view in sidebar order; `undefined` only while the first read is loading. Write through `@/db/repos/views`. */
export function useSavedViews(): SavedView[] | undefined {
  return useLiveQuery(() => db.savedViews.orderBy('order').toArray())
}

/** One saved view: `undefined` while loading, `null` when it does not exist (deleted, or a bad link). */
export function useSavedView(id: ID | undefined): SavedView | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.savedViews.get(id)) ?? null) : null), [id])
}
