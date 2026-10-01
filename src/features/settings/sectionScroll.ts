import { sectionDomId } from './sections'

/** How long a nav click keeps its section highlighted, and holds the scroll on it, while the page settles. */
const HOLD_MS = 1500

/** A section a nav click asked for stays highlighted until the scroll it caused has settled. */
export interface NavLock {
  slug: string
  until: number
}

export function navLock(slug: string): NavLock {
  return { slug, until: performance.now() + HOLD_MS }
}

export function scrollToSection(slug: string, smooth: boolean): void {
  document
    .getElementById(sectionDomId(slug))
    ?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' })
}

const TAKEOVER_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

/**
 * Sections load lazily, so the ones above the target can grow after the page has scrolled to it and push
 * it down the screen. For a moment after a jump, every change in the height of `container` scrolls back to
 * the target, until the person takes the scroll over (wheel, touch, key or pointer). Returns the cleanup.
 */
export function holdAnchor(container: HTMLElement, slug: string): () => void {
  let first = true
  const observer = new ResizeObserver(() => {
    // The first callback is the observation starting, not the layout changing.
    if (first) first = false
    else scrollToSection(slug, false)
  })
  observer.observe(container)
  const stop = () => {
    clearTimeout(timer)
    observer.disconnect()
    for (const type of TAKEOVER_EVENTS) window.removeEventListener(type, stop)
  }
  const timer = setTimeout(stop, HOLD_MS)
  for (const type of TAKEOVER_EVENTS) window.addEventListener(type, stop, { passive: true })
  return stop
}
