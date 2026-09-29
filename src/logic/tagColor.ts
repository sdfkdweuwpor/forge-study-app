/**
 * Deterministic tag → colour. The same tag always gets the same colour on every device, with no
 * stored state; a user override (Settings.tagColors) wins when present.
 */
import type { TagColor } from '@/db/types'

/** The nine tag colours, in palette order (index = hash bucket). */
export const TAG_COLORS: readonly TagColor[] = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
]

function isTagColor(value: unknown): value is TagColor {
  return typeof value === 'string' && (TAG_COLORS as readonly string[]).includes(value)
}

/** Case-insensitive identity of a tag: trimmed, no leading `#`, lower-cased. */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').toLowerCase()
}

/**
 * 32-bit FNV-1a over UTF-16 code units, finished with murmur3's avalanche step so near-identical
 * tags (C182, C183) do not land in neighbouring buckets. Stable across engines: integer maths only.
 */
export function hashTag(tag: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

function overrideFor(
  tag: string,
  overrides: Readonly<Record<string, TagColor>>,
): TagColor | undefined {
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(overrides, key)
  const norm = normalizeTag(tag)
  for (const key of [tag, norm]) {
    if (has(key)) {
      const value = overrides[key]
      if (isTagColor(value)) return value
    }
  }
  for (const key of Object.keys(overrides)) {
    if (normalizeTag(key) === norm) {
      const value = overrides[key]
      if (isTagColor(value)) return value
    }
  }
  return undefined
}

/**
 * The colour for `tag`. Case-insensitive (`c182` and `C182` match), ignores a leading `#`.
 * `overrides` is `Settings.tagColors`; entries holding an unknown colour name are ignored.
 */
export function tagColor(tag: string, overrides?: Readonly<Record<string, TagColor>>): TagColor {
  if (overrides) {
    const chosen = overrideFor(tag, overrides)
    if (chosen) return chosen
  }
  const bucket = hashTag(normalizeTag(tag)) % TAG_COLORS.length
  return TAG_COLORS[bucket] ?? 'gray'
}
