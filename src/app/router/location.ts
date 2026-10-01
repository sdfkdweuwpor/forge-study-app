/**
 * All URL access lives here (DECISIONS: history router). To move to hash routing for a host
 * without SPA rewrites, only this file changes.
 *
 * It is also the only place that knows the base path (`/` on Netlify, `/forge-study-app/` on GitHub
 * Pages): everything inside the app uses base-less paths, and this file strips the base from what the
 * browser reports and adds it to what the browser is given (see base.ts).
 */

import { stripBase, withBase } from './base'
import { isAppPath } from './match'

const NAV_EVENT = 'forge:navigate'

let scrollOnNext = false

/** Vite's base for this build. Read per call, not at load, so a test can stub it for each base. */
const base = (): string => import.meta.env.BASE_URL

/** `pathname + search` of the current location, without the base. Stable string, so it works as a useSyncExternalStore snapshot. */
export function getUrl(): string {
  return stripBase(`${window.location.pathname}${window.location.search}`, base())
}

/** The current pathname without the base (`/tasks/inbox`), for code that asks "which page am I on?". */
export function currentPath(): string {
  return stripBase(window.location.pathname, base())
}

/** An app path as a URL the browser can use, e.g. for `<a href>`: it includes the base. */
export function toHref(path: string): string {
  return withBase(path, base())
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

/**
 * Navigates to an app path (base-less). Returns false, and does nothing, for anything that is not one
 * (see `isAppPath`). A URL that already carries the base, such as the result of `href()`, is accepted
 * too and is never prefixed twice: no route is named after the base, so the two cannot be confused.
 */
export function pushUrl(url: string, replace = false): boolean {
  const path = stripBase(url, base())
  if (!isAppPath(path)) return false
  if (path === getUrl()) return true
  scrollOnNext = !replace
  const target = withBase(path, base())
  if (replace) window.history.replaceState(null, '', target)
  else window.history.pushState(null, '', target)
  window.dispatchEvent(new Event(NAV_EVENT))
  return true
}

/** True once after a push navigation, so the router scrolls to the top exactly once. */
export function consumeScrollFlag(): boolean {
  const v = scrollOnNext
  scrollOnNext = false
  return v
}
