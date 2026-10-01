import { useLiveQuery } from 'dexie-react-hooks'
import { getBadges } from '../repos/badges'
import type { Badge } from '../types'

/**
 * The badges earned so far, oldest unlock first. Live: a badge appears the moment the reconcile inserts
 * it. `undefined` only while the first read is loading; a read that fails throws to the nearest error
 * boundary, like every live query.
 */
export function useBadges(): Badge[] | undefined {
  return useLiveQuery(() => getBadges(), [])
}
