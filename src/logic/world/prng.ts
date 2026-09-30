/**
 * Seeded randomness. Every random choice in the world comes from `mulberry32`, so the same history
 * always grows the same city. No `Math.random`, no clock.
 */

/** Standard mulberry32: a small, fast 32-bit generator returning floats in `[0, 1)`. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** An integer in `[min, maxInclusive]`. */
export function int(rng: () => number, min: number, maxInclusive: number): number {
  return Math.floor(rng() * (maxInclusive - min + 1)) + min
}

/** One element of a non-empty list. */
export function pick<T>(rng: () => number, list: readonly T[]): T {
  const item = list[int(rng, 0, list.length - 1)]
  if (item === undefined) throw new Error('pick: the list is empty')
  return item
}

/** True with probability `p`. */
export function chance(rng: () => number, p: number): boolean {
  return rng() < p
}
