/**
 * All URL access lives here (DECISIONS: history router). To move to hash routing for a host
 * without SPA rewrites, only this file changes.
 */

import { isAppPath } from './match'

const NAV_EVENT = 'forge:navigate'

let scrollOnNext = false

/** `pathname + search` of the current location. Stable string, so it works as a useSyncExternalStore snapshot. */
export function getUrl(): string {
  return `${window.location.pathname}${window.location.search}`
}

export function subscribeLocation(onChange: () => void): () => void {
  const onPop = () => {
    scrollOnNext = false
    onChange()
  }
  window.addEventListener('popstate', onPop)
  window.addEventListener(NAV_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onPop)
    window.removeEventListener(NAV_EVENT, onChange)
  }
}

export function serverUrl(): string {
  return '/'
}

/** Navigates to an app path. Returns false, and does nothing, for anything that is not one (see `isAppPath`). */
export function pushUrl(url: string, replace = false): boolean {
  if (!isAppPath(url)) return false
  if (url === getUrl()) return true
  scrollOnNext = !replace
  if (replace) window.history.replaceState(null, '', url)
  else window.history.pushState(null, '', url)
  window.dispatchEvent(new Event(NAV_EVENT))
  return true
}

/** True once after a push navigation, so the router scrolls to the top exactly once. */
export function consumeScrollFlag(): boolean {
  const v = scrollOnNext
  scrollOnNext = false
  return v
}
