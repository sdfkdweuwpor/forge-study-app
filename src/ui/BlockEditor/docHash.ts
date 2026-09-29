import type { Block } from '@/logic/blocks'

/**
 * A 32-bit fingerprint of a document (FNV-1a over id, type, text, checked and emoji). The editor
 * uses it to recognise its own edits when the parent hands them back as `value`, so a late
 * echo of an older state (a debounced save) is not mistaken for an outside change.
 */
export function docHash(doc: readonly Block[]): number {
  let h = 0x811c9dc5
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0xff // field separator, so ["ab", "c"] and ["a", "bc"] differ
    h = Math.imul(h, 0x01000193)
  }
  for (const b of doc) {
    mix(b.id)
    mix(b.type)
    mix(b.text)
    mix(b.checked === undefined ? '-' : b.checked ? '1' : '0')
    mix(b.emoji ?? '')
  }
  mix(String(doc.length))
  return h >>> 0
}
