/**
 * Fractional ordering for manually sorted lists (pure). A row's position is one number; moving a row
 * between two neighbours only rewrites that row, never the whole list. When repeated moves squeeze two
 * neighbours too close together for a float midpoint to be distinct, callers renumber the list.
 */

/** Gap left between rows when a list is (re)numbered, and when appending or prepending. */
export const ORDER_STEP = 1024

/** Below this gap a midpoint is no longer reliably between its neighbours. */
export const MIN_ORDER_GAP = 1e-3

/**
 * The order value for a row placed between `above` and `below` (either may be `null` at the ends of the
 * list). An empty list yields 0; the first row goes one step before `below`, the last one step after `above`.
 */
export function orderBetween(above: number | null, below: number | null): number {
  if (above === null && below === null) return 0
  if (above === null) return (below as number) - ORDER_STEP
  if (below === null) return above + ORDER_STEP
  return (above + below) / 2
}

/** True when `above` and `below` are too close to fit another row between them. */
export function isCrowded(above: number | null, below: number | null): boolean {
  return above !== null && below !== null && Math.abs(below - above) < MIN_ORDER_GAP
}

/** Fresh, evenly spaced orders for `count` rows: 0, 1024, 2048 … */
export function evenOrders(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => i * ORDER_STEP)
}

/**
 * Where an item ends up when `id` is moved one place up or down inside `ids`.
 * Returns the ids of its new neighbours (`above`, `below`), or `null` when it is already at that end
 * or is not in the list.
 */
export function neighboursAfterStep<T>(
  ids: readonly T[],
  id: T,
  step: -1 | 1,
): { above: T | null; below: T | null } | null {
  const from = ids.indexOf(id)
  if (from === -1) return null
  const to = from + step
  if (to < 0 || to >= ids.length) return null
  const rest = ids.filter((x) => x !== id)
  // After removing `id`, inserting at index `to` puts it between rest[to - 1] and rest[to].
  return { above: rest[to - 1] ?? null, below: rest[to] ?? null }
}

/** The same for a drag: the item is dropped at position `to` of the list that results after the move. */
export function neighboursAtIndex<T>(
  ids: readonly T[],
  id: T,
  to: number,
): { above: T | null; below: T | null } | null {
  if (!ids.includes(id)) return null
  const rest = ids.filter((x) => x !== id)
  const at = Math.max(0, Math.min(rest.length, to))
  return { above: rest[at - 1] ?? null, below: rest[at] ?? null }
}
