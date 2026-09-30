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
  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length
    let reused = false
    const out = next.map((value: unknown, i) => {
      const shared = replaceEqualDeep(prev[i], value)
      if (!Object.is(shared, prev[i])) same = false
      if (!Object.is(shared, value)) reused = true
      return shared
    })
    return (same ? prev : reused ? out : next) as T
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = Object.keys(next)
    let same = keys.length === Object.keys(prev).length
    let reused = false
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      const had = Object.prototype.hasOwnProperty.call(prev, key)
      const shared = had ? replaceEqualDeep(prev[key], next[key]) : next[key]
      if (!had || !Object.is(shared, prev[key])) same = false
      if (!Object.is(shared, next[key])) reused = true
      out[key] = shared
    }
    // Nothing kept from `prev`: the new value as it is (no copy).
    return (same ? prev : reused ? out : next) as T
  }
  return next
}

/**
 * Rows matched by `id` rather than by position, so a row added or removed in the middle does not make
 * every later row look new. Each row is shared with `replaceEqualDeep`; the array is `prev` itself when
 * it holds the same rows in the same order.
 */
export function shareRows<T extends { id: string }>(prev: readonly T[] | undefined, next: T[]): T[] {
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
