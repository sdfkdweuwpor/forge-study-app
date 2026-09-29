import { StrictMode, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { FatalScreen } from './ErrorScreens'
import { bootApp, installGlobalErrorListeners, requestPersistentStorage } from './boot'
import { clearFatal, getFatal, setFatal, subscribeFatal } from './fatal'
import type { Registry } from './registry'
import { toError } from './reportError'

/** How long startup may take before the user sees a way out (an IndexedDB open blocked by another tab hangs silently). */
export const BOOT_TIMEOUT_MS = 10_000

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
  const root = createRoot(rootEl)
  let rendered = false
  const render = () => {
    if (rendered) return
    rendered = true
    root.render(
      <StrictMode>
        <Root registry={registry} />
      </StrictMode>,
    )
    requestPersistentStorage()
  }

  const timer = setTimeout(() => {
    setFatal({ kind: 'boot-timeout' })
    render()
  }, BOOT_TIMEOUT_MS)

  bootApp(registry).then(
    () => {
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
