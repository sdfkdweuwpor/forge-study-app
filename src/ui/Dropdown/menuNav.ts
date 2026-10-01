/**
 * Keyboard navigation maths for menus, on plain arrays so it can be unit-tested without a DOM.
 * `enabled[i]` says whether item i can be focused; disabled items are skipped.
 */

/** Next enabled index from `from` in direction `dir`, wrapping. -1 when nothing is enabled. */
export function stepIndex(enabled: readonly boolean[], from: number, dir: 1 | -1): number {
  const n = enabled.length
  if (n === 0) return -1
  // From "nothing focused" (-1): forward starts at the first item, backward at the last.
  let i = from < 0 ? (dir === 1 ? -1 : n) : from
  for (let step = 0; step < n; step += 1) {
    i = (i + dir + n) % n
    if (enabled[i]) return i
  }
  return -1
}

export const firstIndex = (enabled: readonly boolean[]): number => enabled.findIndex(Boolean)

export const lastIndex = (enabled: readonly boolean[]): number => enabled.lastIndexOf(true)

/**
 * Typeahead: which item to focus after the user typed `buffer`.
 * - A single character cycles through items starting with it, beginning after `current`.
 * - "aaa" (one character repeated) behaves like "a", so holding a key cycles.
 * - A longer buffer looks for the first label starting with it, beginning at `current`, so
 *   extending a match ("n" → "ne") keeps the current item when it still matches.
 * Returns -1 when nothing matches.
 */
export function typeaheadIndex(
  labels: readonly string[],
  enabled: readonly boolean[],
  current: number,
  buffer: string,
): number {
  const typed = buffer.toLowerCase()
  if (typed.length === 0) return -1
  const repeated = typed.length > 1 && [...typed].every((c) => c === typed[0])
  const needle = repeated ? typed.slice(0, 1) : typed
  const n = labels.length
  const start = needle.length === 1 ? current + 1 : Math.max(current, 0)
  for (let step = 0; step < n; step += 1) {
    const i = (((start + step) % n) + n) % n
    if (enabled[i] && (labels[i] ?? '').toLowerCase().startsWith(needle)) return i
  }
  return -1
}
