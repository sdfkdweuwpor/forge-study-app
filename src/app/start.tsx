import { StrictMode, startTransition, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { FatalScreen } from './ErrorScreens'
import { bootApp, installGlobalErrorListeners, requestPersistentStorage } from './boot'
import { preloadForRoute, preloadOverlays } from './bootPreload'
import { clearFatal, getFatal, setFatal, subscribeFatal } from './fatal'
import type { Registry } from './registry'
import { toError } from './reportError'
import { currentPath } from './router'

/** How long startup may take before the user sees a way out (an IndexedDB open blocked by another tab hangs silently). */
export const BOOT_TIMEOUT_MS = 10_000

/** The longest the first render waits for the page's own chunks (see `bootPreload.ts`). */
export const WARM_WAIT_MS = 400

/** The app, or the full-screen failure page when startup or the database has failed. */
function Root({ registry }: { registry: Registry }) {
  const fatal = useSyncExternalStore(subscribeFatal, getFatal, getFatal)
  return fatal ? <FatalScreen fatal={fatal} /> : <App registry={registry} />
}

/**
 * Boots, then renders once, so the first paint is final. If startup fails, or takes longer than
 * BOOT_TIMEOUT_MS, the failure screen (Reload / Export) replaces the app; a slow start that later
 * finishes swaps the app back in.
 */
export function start(rootEl: HTMLElement, registry: Registry): void {
  installGlobalErrorListeners()
  // The page for this address and what it draws download while the database opens, not after.
  const warm = preloadForRoute(registry, currentPath())
  const root = createRoot(rootEl)
  let rendered = false
  const render = () => {
    if (rendered) return
    rendered = true
    // A transition is rendered in slices of a few milliseconds with the main thread handed back between
    // them, so the first screen, the biggest render the app does, never holds up a tap or a scroll.
    startTransition(() => {
      root.render(
        <StrictMode>
          <Root registry={registry} />
        </StrictMode>,
      )
    })
    requestPersistentStorage()
    preloadOverlays(registry)
  }

  const timer = setTimeout(() => {
    setFatal({ kind: 'boot-timeout' })
    render()
  }, BOOT_TIMEOUT_MS)

  bootApp(registry).then(
    async () => {
      // Usually the chunks are already here; on a slow connection the first screen waits for them only
      // this long, so the layout does not shift as they arrive, and never longer.
      await Promise.race([warm, new Promise((resolve) => setTimeout(resolve, WARM_WAIT_MS))])
      clearTimeout(timer)
      clearFatal('boot-timeout')
      render()
    },
    (e: unknown) => {
      clearTimeout(timer)
      setFatal({ kind: 'boot-failed', error: toError(e) })
      render()
    },
  )
}
