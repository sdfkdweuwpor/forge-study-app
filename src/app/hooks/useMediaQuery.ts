import { useCallback, useSyncExternalStore } from 'react'

/** Live `matchMedia` result. Reads synchronously on first render, so layout never flashes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Breakpoints from BRIEF §3.8. */
export const BREAKPOINTS = {
  /** ≥1024px: sidebar + content. */
  desktop: '(min-width: 1024px)',
  /** ≥640px: drawer sidebar; below it, the bottom tab bar. */
  tablet: '(min-width: 640px)',
} as const
