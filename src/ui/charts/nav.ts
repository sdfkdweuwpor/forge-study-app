/**
 * Keyboard model of a chart (pure): which datum an arrow key moves to. Every chart is one tab stop and
 * keeps an "active" datum (or none); the arrows walk it. Charts differ only in what each arrow means
 * (`deltas`) and which data cannot be selected (`enabled`, e.g. days that have not happened).
 */

export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

/** How far each arrow moves the active index. A key that is absent does nothing. */
export type NavDeltas = Partial<Record<NavKey, number>>

export interface NavOptions {
  /** Number of data. */
  count: number
  deltas: NavDeltas
  /** Where the first key press lands when nothing is active yet. */
  initial: number
  /** `false` for a datum that cannot be active. Default: all can. */
  enabled?: (index: number) => boolean
}

const DELTA_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']

/**
 * The index a key press moves to, `current` when it cannot move (already at an edge), or `null` when the
 * chart does not use the key. Home and End jump to the first and last datum that can be active. With
 * nothing active (`current` is `null`), any navigation key lands on `initial`.
 */
export function navTarget(key: string, current: number | null, options: NavOptions): number | null {
  const { count, deltas, initial } = options
  const enabled = options.enabled ?? (() => true)
  if (count <= 0) return null
  const last = count - 1

  const firstEnabled = (from: number, step: 1 | -1): number | null => {
    for (let i = from; i >= 0 && i <= last; i += step) if (enabled(i)) return i
    return null
  }

  if (key === 'Home') return firstEnabled(0, 1) ?? current
  if (key === 'End') return firstEnabled(last, -1) ?? current
  if (!DELTA_KEYS.includes(key)) return null
  const delta = deltas[key as NavKey]
  if (delta === undefined || delta === 0) return null

  if (current === null || current < 0 || current > last) {
    return enabled(initial) ? initial : (firstEnabled(initial, 1) ?? firstEnabled(initial, -1))
  }
  const step = delta > 0 ? 1 : -1
  let target = current + delta
  // A step that lands on something that cannot be active keeps going the same way until it finds one.
  while (target >= 0 && target <= last && !enabled(target)) target += step
  if (target < 0 || target > last) return current
  return target
}
