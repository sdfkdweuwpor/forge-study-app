/**
 * Structural sharing for live query results (pure). A Dexie live query hands back brand-new objects
 * every time it re-runs, even when nothing it read has changed, so every `memo` row and every
 * `useMemo` keyed on a row re-renders or recomputes. These helpers keep the previous objects wherever
 * the new data is equal to them, so an unchanged row keeps its identity and a result with no change at
 * all is the previous value itself (React then skips the update entirely).
 *
 * Only JSON-like data (primitives, arrays, plain objects) is shared; anything else (Dates, Maps, Blobs)
 * is taken from the new value as it is. Equality is structural, like `deepEqual`: key order does not
 * matter and NaN equals NaN.
 */

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto: unknown = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * `next`, with every part that is structurally equal to the same part of `prev` replaced by `prev`'s.
 * Returns `prev` itself when the two are equal.
 */
export function replaceEqualDeep<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next
  // Nothing is copied while the two agree: a copy starts at the first part that differs, and when
  // nothing of `prev` could be kept, `next` itself is returned. Most re-runs of a live query change
  // nothing, so the common path allocates nothing.
  if (Array.isArray(prev) && Array.isArray(next)) {
    let out: unknown[] | null = null
    let reused = false
    for (let i = 0; i < next.length; i++) {
      const shared: unknown = replaceEqualDeep(prev[i], next[i])
      if (!Object.is(shared, next[i])) reused = true
      if (out === null && !(i < prev.length && Object.is(shared, prev[i]))) out = prev.slice(0, i)
      if (out !== null) out.push(shared)
    }
    if (out === null && prev.length === next.length) return prev as T
    return (reused ? (out ?? prev.slice(0, next.length)) : next) as T
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = Object.keys(next)
    let out: Record<string, unknown> | null = null
    let reused = false
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] as string
      const had = Object.prototype.hasOwnProperty.call(prev, key)
      const shared: unknown = had ? replaceEqualDeep(prev[key], next[key]) : next[key]
      if (!Object.is(shared, next[key])) reused = true
      if (out === null && !(had && Object.is(shared, prev[key]))) {
        out = {}
        for (let j = 0; j < i; j++) {
          const k = keys[j] as string
          out[k] = prev[k]
        }
      }
      if (out !== null) out[key] = shared
    }
    if (out === null && keys.length === Object.keys(prev).length) return prev as T
    if (!reused) return next
    if (out === null) {
      out = {}
      for (const key of keys) out[key] = prev[key]
    }
    return out as T
  }
  return next
}

/**
 * Rows matched by `id` rather than by position, so a row added or removed in the middle does not make
 * every later row look new. Each row is shared with `replaceEqualDeep`; the array is `prev` itself when
 * it holds the same rows in the same order.
 */
export function shareRows<T extends { id: string }>(
  prev: readonly T[] | undefined,
  next: T[],
): T[] {
  if (prev === undefined) return next
  const before = new Map<string, T>()
  for (const row of prev) before.set(row.id, row)
  let same = prev.length === next.length
  const out = next.map((row, i) => {
    const shared = replaceEqualDeep(before.get(row.id), row)
    if (shared !== prev[i]) same = false
    return shared
  })
  return same ? (prev as T[]) : out
}

/**
 * A function that remembers what it returned last and shares each new value with it. Create one per
 * live query (for example in a `useState` initialiser) and pass the query's result through it.
 */
export function sharer<T>(share: (prev: T | undefined, next: T) => T): (next: T) => T {
  let last: T | undefined
  return (next) => {
    last = share(last, next)
    return last
  }
}

/** `sharer` for any JSON-like value (`replaceEqualDeep`). */
export const valueSharer = <T>(): ((next: T) => T) =>
  sharer<T>((prev, next) => replaceEqualDeep(prev, next))

/** `sharer` for a list of rows with ids (`shareRows`). */
export const rowSharer = <T extends { id: string }>(): ((next: T[]) => T[]) =>
  sharer<T[]>((prev, next) => shareRows(prev, next))
