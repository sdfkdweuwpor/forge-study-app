/**
 * Square-spiral plot coordinates. `spiral(0)` is the centre; ring `r >= 1` starts at `(r, 1 - r)`,
 * goes down (+y) to `(r, r)`, left to `(-r, r)`, up to `(-r, -r)` and right to `(r, -r)`.
 * O(1) per call.
 */
export function spiral(n: number): { x: number; y: number } {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`spiral: n must be a whole number >= 0, got ${n}`)
  if (n === 0) return { x: 0, y: 0 }
  // The ring is the smallest r with (2r + 1)^2 > n.
  let r = Math.ceil((Math.sqrt(n + 1) - 1) / 2)
  while ((2 * r - 1) ** 2 > n) r -= 1
  while ((2 * r + 1) ** 2 <= n) r += 1
  const i = n - (2 * r - 1) ** 2 // 0 .. 8r - 1 within the ring
  const side = Math.floor(i / (2 * r))
  const j = i - side * 2 * r
  switch (side) {
    case 0:
      return { x: r, y: 1 - r + j }
    case 1:
      return { x: r - 1 - j, y: r }
    case 2:
      return { x: -r, y: r - 1 - j }
    default:
      return { x: 1 - r + j, y: -r }
  }
}
