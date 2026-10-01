import { useEffect, useState } from 'react'

/**
 * Keeps an element mounted for `exitMs` after `open` turns false so its exit animation can play.
 * Returns whether to render. The element should switch `data-state` between "open" and "closed"
 * from `open`; enter and exit are CSS keyframes keyed on that attribute.
 */
export function usePresence(open: boolean, exitMs: number): boolean {
  const [mounted, setMounted] = useState(open)
  // Mount in the same render that opens, so the enter animation starts on the first paint.
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open) return undefined
    const timer = window.setTimeout(() => setMounted(false), exitMs)
    return () => window.clearTimeout(timer)
  }, [open, exitMs])

  return open || mounted
}
