/**
 * Progressive rendering for long lists (pure). A row of a task list is a few milliseconds of React and
 * layout, so a year of scheduled study (hundreds of open tasks) or of finished work (thousands) cannot
 * all be drawn at once. A list draws its first `LIST_PAGE` rows and adds `LIST_STEP` more as the end
 * comes near (or on "Show more"); the keyboard selection is always drawn, however far down it is.
 */

/** Rows drawn when a list opens. */
export const LIST_PAGE = 100
/** Rows added each time the end of the list comes into view. */
export const LIST_STEP = 200

/**
 * How many rows to draw: at least `limit`, always through the selected row (`selectedIndex`, -1 for
 * none), never more than `total`.
 */
export function rowsToDraw(total: number, limit: number, selectedIndex: number): number {
  return Math.max(0, Math.min(total, Math.max(limit, selectedIndex + 1)))
}

/** The first `count` rows of groups laid out one after another: how many of each group that is. */
export function takePerGroup(sizes: readonly number[], count: number): number[] {
  let left = Math.max(0, count)
  return sizes.map((size) => {
    const take = Math.min(size, left)
    left -= take
    return take
  })
}

/** The position of the row with `id` across all groups, or -1. */
export function indexAcross(
  groups: ReadonlyArray<{ tasks: ReadonlyArray<{ id: string }> }>,
  id: string | null,
): number {
  if (id === null) return -1
  let at = 0
  for (const group of groups) {
    for (const task of group.tasks) {
      if (task.id === id) return at
      at++
    }
  }
  return -1
}
