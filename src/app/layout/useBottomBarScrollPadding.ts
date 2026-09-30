import { useEffect, type RefObject } from 'react'

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
    const els = bars.flatMap((bar) => (bar.current ? [bar.current] : []))
    if (els.length === 0) return undefined
    const page = document.documentElement
    const update = () => {
      const px = Math.max(0, ...els.map(reach))
      if (px > 0) page.style.scrollPaddingBottom = `${Math.ceil(px) + gap}px`
      else page.style.removeProperty('scroll-padding-bottom')
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    for (const el of els) observer?.observe(el)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      page.style.removeProperty('scroll-padding-bottom')
    }
  }, [bars, gap])
}
