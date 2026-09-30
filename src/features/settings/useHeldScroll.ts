import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { holdAnchor } from './sectionScroll'

/**
 * `hold(slug)` keeps the page scrolled to a section while lazy sections above it finish loading (see
 * `holdAnchor`). Put `containerRef` on the element that wraps every section.
 */
export function useHeldScroll(): {
  containerRef: RefObject<HTMLDivElement | null>
  hold: (slug: string) => void
} {
  const containerRef = useRef<HTMLDivElement>(null)
  const release = useRef<(() => void) | null>(null)
  const hold = useCallback((slug: string) => {
    release.current?.()
    release.current = containerRef.current ? holdAnchor(containerRef.current, slug) : null
  }, [])
  useEffect(() => () => release.current?.(), [])
  return { containerRef, hold }
}
