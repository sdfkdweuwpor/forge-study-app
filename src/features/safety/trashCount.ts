/**
 * How many entries the Trash held when it was last read, for the palette: a command's `when` cannot wait
 * for a database read, so `SafetyHost` (mounted for the whole session) keeps this up to date with a live
 * count. `null` until the first read, and then every command shows.
 */
let known: number | null = null

export function publishTrashCount(count: number | undefined): void {
  known = count ?? null
}

/** True only when the Trash is known to be empty. */
export function trashIsKnownEmpty(): boolean {
  return known === 0
}
