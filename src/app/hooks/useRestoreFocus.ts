import { useEffect, useRef, useState } from 'react'

/**
 * For an overlay that is mounted only while open: remembers what had focus when the caller first
 * rendered and gives it back when the caller goes away (an overlay that is removed rather than
 * closed cannot rely on the browser to do it). Nothing happens when that element is gone, or when
 * focus is already back on it. Safe under StrictMode, whose test unmount and remount is not a close.
 */
export function useRestoreFocus(): void {
  const [origin] = useState<Element | null>(() => document.activeElement)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // StrictMode runs this cleanup and the effect again within one commit; a real unmount does not.
      queueMicrotask(() => {
        if (mounted.current) return
        if (origin instanceof HTMLElement && origin.isConnected) origin.focus({ preventScroll: true })
      })
    }
  }, [origin])
}
