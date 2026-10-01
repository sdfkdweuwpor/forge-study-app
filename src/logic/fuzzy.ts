/**
 * Fuzzy subsequence matching for the command palette (pure, allocation-light).
 *
 * The query's characters must appear in the text in order (case-insensitive; whitespace in the query
 * is ignored). Among all alignments the best one wins, found with a small dynamic programme
 * (O(query × text)) after an O(text) subsequence pre-check that rejects most items immediately.
 *
 * Scoring: every matched character earns a base amount; more for characters that start a word (after
 * a space, `-`, `_`, `/`, `.` …, or a lower→UPPER camel hump), more for characters that directly
 * follow the previous match, and a little for exact case. Gaps between matches cost an opening charge
 * plus a per-character charge, and leading characters before the first match cost a small capped
 * amount. A tiny length penalty makes shorter texts win ties.
 */

export interface FuzzyMatch {
  /** Higher is better. Only comparable between results of the same query. */
  score: number
  /** UTF-16 indices in `text` of the matched characters, ascending (for highlighting). */
  matches: number[]
}

export interface FuzzyResult<T> extends FuzzyMatch {
  item: T
}

const NEG = -1e9
const BASE = 16
const BOUNDARY_BONUS = 8
const CAMEL_BONUS = 6
const CONSECUTIVE_BONUS = 6
const CASE_BONUS = 1
const GAP_OPEN = 3
const GAP_EXTEND = 1
const LEADING_PENALTY = 0.5
const LEADING_PENALTY_CAP = 5
const LENGTH_PENALTY = 0.05

// Scratch buffers, grown on demand and reused so scoring thousands of items does not allocate.
let scores = new Float64Array(0)
let prevIndex = new Int32Array(0)
let lowered = new Uint16Array(0)
let bonuses = new Float64Array(0)

function lowerCode(code: number): number {
  if (code < 128) return code >= 65 && code <= 90 ? code + 32 : code
  const lower = String.fromCharCode(code).toLowerCase()
  return lower.length === 1 ? lower.charCodeAt(0) : code
}

function isWordChar(code: number): boolean {
  if (code < 128) {
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
  }
  return /[\p{L}\p{N}]/u.test(String.fromCharCode(code))
}

function isUpper(code: number): boolean {
  if (code < 128) return code >= 65 && code <= 90
  const ch = String.fromCharCode(code)
  return ch !== ch.toLowerCase()
}

interface PreparedQuery {
  lower: Uint16Array
  original: Uint16Array
}

function prepareQuery(query: string): PreparedQuery {
  const lower: number[] = []
  const original: number[] = []
  for (let i = 0; i < query.length; i++) {
    const code = query.charCodeAt(i)
    // Whitespace (space, tab, NBSP, …) separates words but is never matched itself.
    if (code === 32 || (code >= 9 && code <= 13) || code === 160) continue
    lower.push(lowerCode(code))
    original.push(code)
  }
  return { lower: Uint16Array.from(lower), original: Uint16Array.from(original) }
}

function ensureCapacity(cells: number, textLength: number): void {
  if (scores.length < cells) {
    scores = new Float64Array(cells)
    prevIndex = new Int32Array(cells)
  }
  if (lowered.length < textLength) {
    lowered = new Uint16Array(textLength)
    bonuses = new Float64Array(textLength)
  }
}

function scoreWith(q: PreparedQuery, text: string): FuzzyMatch | null {
  const m = q.lower.length
  const n = text.length
  if (m === 0) return { score: 0, matches: [] }
  if (m > n) return null

  ensureCapacity(m * n, n)

  // Lower-case the text once and check the query is a subsequence at all.
  let qi = 0
  for (let j = 0; j < n; j++) {
    const lc = lowerCode(text.charCodeAt(j))
    lowered[j] = lc
    if (qi < m && lc === q.lower[qi]) qi++
  }
  if (qi < m) return null

  // Per-position bonus for starting a word.
  for (let j = 0; j < n; j++) {
    if (j === 0) {
      bonuses[j] = BOUNDARY_BONUS
      continue
    }
    const prev = text.charCodeAt(j - 1)
    const cur = text.charCodeAt(j)
    if (!isWordChar(prev)) bonuses[j] = BOUNDARY_BONUS
    else if (isUpper(cur) && !isUpper(prev)) bonuses[j] = CAMEL_BONUS
    else bonuses[j] = 0
  }

  for (let i = 0; i < m; i++) {
    const row = i * n
    const target = q.lower[i] ?? 0
    const exact = q.original[i] ?? 0
    // Best `score[i-1][k] − GAP_EXTEND·(j−1−k)` over k ≤ j−2, and the k that gave it.
    let gap = NEG
    let gapFrom = -1
    for (let j = 0; j < n; j++) {
      if (i > 0 && j >= 2) {
        const candidate = (scores[row - n + (j - 2)] ?? NEG) - GAP_EXTEND
        gap -= GAP_EXTEND
        if (candidate > gap) {
          gap = candidate
          gapFrom = j - 2
        }
      }
      if (lowered[j] !== target || j < i) {
        scores[row + j] = NEG
        continue
      }
      const here = BASE + (bonuses[j] ?? 0) + (text.charCodeAt(j) === exact ? CASE_BONUS : 0)
      if (i === 0) {
        scores[row + j] = here - Math.min(j * LEADING_PENALTY, LEADING_PENALTY_CAP)
        prevIndex[row + j] = -1
        continue
      }
      let best = NEG
      let from = -1
      if (j >= 1) {
        const adjacent = scores[row - n + (j - 1)] ?? NEG
        if (adjacent > NEG / 2) {
          best = adjacent + CONSECUTIVE_BONUS
          from = j - 1
        }
      }
      if (gap > NEG / 2 && gap - GAP_OPEN > best) {
        best = gap - GAP_OPEN
        from = gapFrom
      }
      if (from < 0) {
        scores[row + j] = NEG
      } else {
        scores[row + j] = best + here
        prevIndex[row + j] = from
      }
    }
  }

  const last = (m - 1) * n
  let bestScore = NEG
  let bestJ = -1
  for (let j = m - 1; j < n; j++) {
    const s = scores[last + j] ?? NEG
    if (s > bestScore) {
      bestScore = s
      bestJ = j
    }
  }
  if (bestJ < 0 || bestScore <= NEG / 2) return null

  const matches = new Array<number>(m)
  let j = bestJ
  for (let i = m - 1; i >= 0; i--) {
    matches[i] = j
    j = prevIndex[i * n + j] ?? -1
  }
  return { score: bestScore - n * LENGTH_PENALTY, matches }
}

/**
 * Scores `text` against `query`, or `null` when the query is not a subsequence of the text.
 * An empty (or all-whitespace) query matches everything with score 0 and no highlights.
 */
export function fuzzyScore(query: string, text: string): FuzzyMatch | null {
  return scoreWith(prepareQuery(query), text)
}

/**
 * Filters and ranks `items` by how well `getText(item)` matches `query`: best score first, then the
 * shorter text, then the original order (so results are deterministic). An empty query returns the
 * first `limit` items unchanged. Fast enough to run on every keystroke over thousands of items.
 */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
  limit: number = Infinity,
): FuzzyResult<T>[] {
  if (!(limit > 0)) return []
  const q = prepareQuery(query)
  if (q.lower.length === 0) {
    return items.slice(0, limit).map((item) => ({ item, score: 0, matches: [] }))
  }
  const hits: Array<FuzzyResult<T> & { index: number; length: number }> = []
  for (let index = 0; index < items.length; index++) {
    const item = items[index] as T
    const text = getText(item)
    const found = scoreWith(q, text)
    if (found)
      hits.push({ item, score: found.score, matches: found.matches, index, length: text.length })
  }
  hits.sort((a, b) => b.score - a.score || a.length - b.length || a.index - b.index)
  const top = hits.length > limit ? hits.slice(0, limit) : hits
  return top.map(({ item, score, matches }) => ({ item, score, matches }))
}
