import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  const viewport = window.visualViewport
  if (!viewport) return () => undefined
  viewport.addEventListener('resize', onChange)
  viewport.addEventListener('scroll', onChange)
  return () => {
    viewport.removeEventListener('resize', onChange)
    viewport.removeEventListener('scroll', onChange)
  }
}

/** How much of the layout viewport the on-screen keyboard covers, in px (0 where the keyboard resizes the page). */
function read(): number {
  const viewport = window.visualViewport
  if (!viewport) return 0
  return Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
}

/** Lets a bottom sheet sit above the mobile keyboard (iOS Safari does not resize the layout viewport). */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, read, () => 0)
}
