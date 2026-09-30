import { useEffect, type RefObject } from 'react'

/** What each mounted bar asks of the page: its height plus air. The page takes the tallest. */
const claims = new Map<object, number>()

function publish(): void {
  const px = Math.max(0, ...claims.values())
  const page = document.documentElement
  if (px > 0) page.style.scrollPaddingTop = `${px}px`
  else page.style.removeProperty('scroll-padding-top')
}

/**
 * While the caller is mounted, keeps whatever the browser scrolls into view (a control that takes
 * focus on Tab, an anchor) from landing underneath a sticky or fixed bar at the top of the page: the
 * page gets `scroll-padding-top` of the bar's height plus `gap`. Only a bar pinned to the very top counts:
 * one that is static at the moment (sticky from a wide breakpoint only) or a side rail that sticks a
 * little way down asks for nothing. Several bars can be mounted at once.
 */
export function useStickyScrollPadding(bar: RefObject<HTMLElement | null>, gap = 8): void {
  useEffect(() => {
    const el = bar.current
    if (!el) return undefined
    const claim = {}
    const update = () => {
      const { position, top } = getComputedStyle(el)
      const pinned = (position === 'sticky' || position === 'fixed') && parseFloat(top) === 0
      claims.set(claim, pinned ? Math.ceil(el.getBoundingClientRect().height) + gap : 0)
      publish()
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(el)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      claims.delete(claim)
      publish()
    }
  }, [bar, gap])
}
