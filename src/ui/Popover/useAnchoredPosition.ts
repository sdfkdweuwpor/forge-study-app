import { useLayoutEffect, useState } from 'react'
import { computePosition, type Align, type PositionResult, type Side } from './position'

interface Options {
  anchor: HTMLElement | null
  floating: HTMLElement | null
  /** Only measure and listen while true. */
  active: boolean
  side?: Side
  align?: Align
  offset?: number
  flip?: boolean
}

const same = (a: PositionResult | null, b: PositionResult): boolean =>
  a !== null &&
  a.x === b.x &&
  a.y === b.y &&
  a.side === b.side &&
  a.maxHeight === b.maxHeight &&
  a.origin.x === b.origin.x &&
  a.origin.y === b.origin.y

/**
 * Positions `floating` next to `anchor` (viewport coordinates, for `position: fixed`) and keeps it
 * there through scroll, resize and content size changes. Returns null until the first measurement,
 * so callers can hide the box for that one layout pass.
 */
export function useAnchoredPosition({
  anchor,
  floating,
  active,
  side,
  align,
  offset,
  flip,
}: Options): PositionResult | null {
  const [result, setResult] = useState<PositionResult | null>(null)

  useLayoutEffect(() => {
    if (!active || !anchor || !floating) return undefined

    const update = () => {
      const rect = anchor.getBoundingClientRect()
      const next = computePosition({
        anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        // offset* ignore the enter/exit transform; scrollHeight is the natural height even when
        // max-height makes the box scroll.
        floating: {
          width: floating.offsetWidth,
          height: Math.max(floating.offsetHeight, floating.scrollHeight),
        },
        viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
        side,
        align,
        offset,
        flip,
      })
      setResult((prev) => (same(prev, next) ? prev : next))
    }

    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(floating)
    observer.observe(anchor)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, { capture: true })
      observer.disconnect()
    }
  }, [active, anchor, floating, side, align, offset, flip])

  return active ? result : null
}
