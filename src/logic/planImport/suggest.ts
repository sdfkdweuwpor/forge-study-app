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

/** The option closest to `input` within `maxDistance` edits, or `undefined` when nothing is close. */
export function closestMatch(
  input: string,
  options: Iterable<string>,
  maxDistance = 2,
): string | undefined {
  let best: string | undefined
  let bestDistance = maxDistance + 1
  for (const option of options) {
    const d = editDistance(input, option)
    if (d < bestDistance) {
      best = option
      bestDistance = d
    }
  }
  return best
}
