/** Edit distance between two short strings (case-insensitive). Used for "did you mean …?" hints. */
export function editDistance(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  if (x === y) return 0
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const row: number[] = [i]
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      row.push(Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost))
    }
    prev = row
  }
  return prev[y.length] ?? 0
}

/** Length of the shared start of two strings (case-insensitive). */
function commonPrefix(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  let n = 0
  while (n < x.length && n < y.length && x[n] === y[n]) n++
  return n
}

/** Options sharing at least this many leading letters count as an abbreviation ("prereqs" → "prerequisites"). */
const ABBREVIATION_PREFIX = 5

/**
 * The option closest to `input`: within `maxDistance` edits, else an abbreviation that shares its first
 * few letters (edit distance cannot reach "prereqs" → "prerequisites"). `undefined` when nothing is close.
 */
export function closestMatch(
  input: string,
  options: Iterable<string>,
  maxDistance = 2,
): string | undefined {
  const all = [...options]
  let best: string | undefined
  let bestDistance = maxDistance + 1
  for (const option of all) {
    const d = editDistance(input, option)
    if (d < bestDistance) {
      best = option
      bestDistance = d
    }
  }
  if (best !== undefined) return best

  let bestPrefix = ABBREVIATION_PREFIX - 1
  for (const option of all) {
    const n = commonPrefix(input, option)
    if (n > bestPrefix) {
      best = option
      bestPrefix = n
    }
  }
  return best
}
