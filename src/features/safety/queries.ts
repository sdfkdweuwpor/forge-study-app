import { useLiveQuery } from 'dexie-react-hooks'
import { listSnapshots, type SnapshotInfo } from '@/db/repos/snapshots'
import { countTrash, listTrash } from '@/db/repos/trash'
import type { TrashEntry } from '@/logic/trashList'

/**
 * Live reads for the Trash page and the Snapshots section. Each is `undefined` only while the first read
 * is loading; a read that fails throws to the nearest error boundary, like every live query. Write through
 * `@/db/repos/trash` and `@/db/repos/snapshots`.
 */

/** Every entry in the Trash, newest deletion first, with what came along and where it lived. */
export function useTrash(): TrashEntry[] | undefined {
  return useLiveQuery(() => listTrash(), [])
}

/** Every snapshot, newest first (without their data). */
export function useSnapshots(): SnapshotInfo[] | undefined {
  return useLiveQuery(() => listSnapshots(), [])
}

/** How many entries are in the Trash (cheaper than `useTrash`, for what only needs to know if there are any). */
export function useTrashCount(): number | undefined {
  return useLiveQuery(() => countTrash(), [])
}
