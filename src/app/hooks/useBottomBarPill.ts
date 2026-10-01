import { useEffect } from 'react'

/** Fixed elements a page adds above the tab bar (the phone's sound and timer pills) carry this attribute. */
export const BOTTOM_BAR_ATTR = 'data-bottom-bar'
export const BOTTOM_BARS_CHANGED = 'forge:bottom-bars'

/**
 * Call from a pill that is fixed above the tab bar (and put `data-bottom-bar` on its element) while it
 * is drawn: the scroll padding is told when it appears and goes, so Tab never lands under it.
 */
export function useBottomBarPill(active = true): void {
  useEffect(() => {
    if (!active) return undefined
    window.dispatchEvent(new Event(BOTTOM_BARS_CHANGED))
    return () => {
      window.dispatchEvent(new Event(BOTTOM_BARS_CHANGED))
    }
  }, [active])
}
