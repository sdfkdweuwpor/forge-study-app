import { mulberry32 } from './prng'

/** FNV-1a, 32 bits, over UTF-16 code units. */
export function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * The generator for one item. Each item draws only from its own stream, never from a shared one,
 * so adding or reordering other items cannot change what this one looks like.
 */
export function rngFor(seed: number, id: string): () => number {
  return mulberry32(hash32(`${seed}:${id}`))
}
