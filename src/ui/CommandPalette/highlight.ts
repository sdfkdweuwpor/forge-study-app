/** Splits text into runs so matched characters can be rendered emphasised. */
export interface HighlightSegment {
  text: string
  hit: boolean
}

/**
 * `matches` are indices into `text` as JavaScript counts them (UTF-16 code units, like
 * `String.prototype.indexOf`), in any order. Out-of-range and non-integer values are ignored, and a
 * surrogate pair (an emoji) is never split: if either half matched, the whole character is a hit.
 */
export function highlightSegments(
  text: string,
  matches: readonly number[] | undefined,
): HighlightSegment[] {
  if (text === '') return []
  if (!matches || matches.length === 0) return [{ text, hit: false }]

  const hit: boolean[] = Array.from({ length: text.length }, () => false)
  for (const i of matches) {
    if (Number.isInteger(i) && i >= 0 && i < text.length) hit[i] = true
  }
  for (let i = 0; i < text.length - 1; i += 1) {
    const high = text.charCodeAt(i)
    const low = text.charCodeAt(i + 1)
    if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {
      const both = hit[i] === true || hit[i + 1] === true
      hit[i] = both
      hit[i + 1] = both
    }
  }

  const segments: HighlightSegment[] = []
  let start = 0
  for (let i = 1; i <= text.length; i += 1) {
    if (i === text.length || hit[i] !== hit[start]) {
      segments.push({ text: text.slice(start, i), hit: hit[start] === true })
      start = i
    }
  }
  return segments
}
