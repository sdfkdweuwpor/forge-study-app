import { useEffect, type RefObject } from 'react'
import { BOTTOM_BAR_ATTR, BOTTOM_BARS_CHANGED as CHANGED } from '../hooks/useBottomBarPill'

/** The space a fixed element takes from the bottom of the window: how far up its top edge reaches. */
function reach(el: HTMLElement): number {
  const { position, bottom } = getComputedStyle(el)
  if (position !== 'fixed') return 0
  const offset = parseFloat(bottom)
  return (Number.isNaN(offset) ? 0 : offset) + el.getBoundingClientRect().height
}

/**
 * While the caller is mounted, keeps whatever the browser scrolls into view (a control that takes focus
 * on Tab, an anchor) from landing underneath the bars that are fixed to the bottom of the window: the page
 * gets `scroll-padding-bottom` of the tallest one's reach plus `gap`. It is the twin of
 * `useStickyScrollPadding`, which does the same for a bar at the top.
 *
 * On a phone those are the tab bar and the floating + above it. Both count, since the + sits over the
 * right edge of the page, where rows keep their menu buttons. Reach is measured, not assumed: a
 * bigger font makes a taller bar, and the safe-area inset under it differs from phone to phone.
 */
export function useBottomBarScrollPadding(
  bars: readonly RefObject<HTMLElement | null>[],
  gap = 8,
): void {
  useEffect(() => {
    const own = bars.flatMap((bar) => (bar.current ? [bar.current] : []))
    if (own.length === 0) return undefined
    const page = document.documentElement
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => update())
    const update = () => {
      const pills = [...document.querySelectorAll<HTMLElement>(`[${BOTTOM_BAR_ATTR}]`)]
      for (const el of pills) observer?.observe(el)
      const px = Math.max(0, ...[...own, ...pills].map(reach))
      if (px > 0) page.style.scrollPaddingBottom = `${Math.ceil(px) + gap}px`
      else page.style.removeProperty('scroll-padding-bottom')
    }
    update()
    for (const el of own) observer?.observe(el)
    window.addEventListener('resize', update)
    window.addEventListener(CHANGED, update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener(CHANGED, update)
      page.style.removeProperty('scroll-padding-bottom')
    }
  }, [bars, gap])
}
