import type { Placed } from './types'

/**
 * Keyboard browsing of the earned items, in the order they are drawn (back to front). The list is
 * `WorldModel.earned`, which is already depth-sorted.
 */

/** The item earned last (ties go to the one drawn last): where browsing starts. */
export function newestItem(earned: readonly Placed[]): Placed | null {
  let best: Placed | null = null
  for (const p of earned) {
    if (best === null || (p.earnedAt ?? 0) >= (best.earnedAt ?? 0)) best = p
  }
  return best
}

/**
 * The item `delta` steps along the draw order from `currentId` (positive = nearer the viewer). It stops
 * at either end instead of wrapping. With no current item, browsing starts at the newest one.
 */
export function stepItem(earned: readonly Placed[], currentId: string | null, delta: number): Placed | null {
  if (earned.length === 0) return null
  const at = currentId === null ? -1 : earned.findIndex((p) => p.id === currentId)
  if (at === -1) return newestItem(earned)
  const next = Math.min(earned.length - 1, Math.max(0, at + delta))
  return earned[next] ?? null
}
