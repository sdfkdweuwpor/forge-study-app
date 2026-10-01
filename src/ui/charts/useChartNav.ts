import { useCallback, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { navTarget, type NavDeltas } from './nav'

export interface UseChartNavOptions {
  /** Number of data. */
  count: number
  /** What each arrow key does (see `nav.ts`). */
  deltas: NavDeltas
  /** The datum a first key press or a keyboard focus lands on. */
  initial: number
  /** `false` for data that cannot be active (days that have not happened). */
  enabled?: (index: number) => boolean
}

export interface ChartNav {
  /** The active datum, or `null` (no tooltip). */
  active: number | null
  /** Pointer moved over datum `index`. */
  hover: (index: number) => void
  /** Pointer left the chart. */
  leave: () => void
  /** Spread onto the `<svg>`. */
  handlers: {
    onKeyDown: (e: KeyboardEvent<SVGSVGElement>) => void
    onFocus: (e: FocusEvent<SVGSVGElement>) => void
    onBlur: () => void
  }
}

/**
 * The shared interaction of every chart: one tab stop, arrow keys walk the active datum, Home/End jump,
 * Escape hides the tooltip (and only then stops the key, so it still closes overlays when nothing is
 * shown), the pointer sets the active datum too, and leaving or blurring clears it. Keyboard focus
 * shows the tooltip at once; a mouse click that focuses the chart does not.
 */
export function useChartNav({ count, deltas, initial, enabled }: UseChartNavOptions): ChartNav {
  const [raw, setRaw] = useState<number | null>(null)
  const byPointer = useRef(false)
  // The data can shrink (a resize, a new range) while an index is held.
  const active = raw !== null && raw < count ? raw : null

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'Escape') {
      if (active !== null) {
        e.stopPropagation()
        setRaw(null)
      }
      return
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const next = navTarget(e.key, active, { count, deltas, initial, enabled })
    if (next === null) return
    e.preventDefault()
    byPointer.current = false
    setRaw(next)
  }

  const onFocus = (e: FocusEvent<SVGSVGElement>) => {
    if (active === null && e.currentTarget.matches(':focus-visible')) {
      byPointer.current = false
      setRaw(enabled && !enabled(initial) ? null : initial)
    }
  }

  const onBlur = () => setRaw(null)

  const hover = useCallback((index: number) => {
    byPointer.current = true
    setRaw(index)
  }, [])

  const leave = useCallback(() => {
    if (byPointer.current) setRaw(null)
  }, [])

  return { active, hover, leave, handlers: { onKeyDown, onFocus, onBlur } }
}
