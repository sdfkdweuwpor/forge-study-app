import { useCallback, useRef, useSyncExternalStore, type RefObject } from 'react'

/**
 * The live width in px of the element `ref` is attached to (0 until it is on screen). Charts render at
 * the pixel width they are given, so text is never stretched. Uses a `ResizeObserver`; without one it
 * falls back to window resize events.
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const subscribe = useCallback((notify: () => void) => {
    const el = ref.current
    if (!el) return () => {}
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', notify)
      return () => window.removeEventListener('resize', notify)
    }
    const observer = new ResizeObserver(notify)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const width = useSyncExternalStore(
    subscribe,
    () => ref.current?.clientWidth ?? 0,
    () => 0,
  )
  return [ref, width]
}
