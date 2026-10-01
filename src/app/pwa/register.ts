/**
 * Registers the service worker and feeds its update events to `updateStore`. Loaded on demand by
 * `PwaHost` (never imported statically: `virtual:pwa-register` only exists inside the Vite build, so
 * a static import would break the unit tests that load every feature manifest).
 */
import { registerSW } from 'virtual:pwa-register'
import { updateCheckDue } from '@/logic/pwaUpdate'
import { recordError } from '../reportError'
import { updateStore } from './updateStore'

/** Least time between two update checks: an installed app can stay open for days without a navigation. */
const CHECK_GAP_MS = 60 * 60 * 1000

let started = false

/** Looks for a newer worker every hour and whenever the app returns to the foreground. */
function watchForUpdates(registration: ServiceWorkerRegistration): void {
  let lastCheckAt: number | null = Date.now()
  const check = () => {
    const now = Date.now()
    if (!updateCheckDue({ lastCheckAt, now, online: navigator.onLine, minGapMs: CHECK_GAP_MS }))
      return
    lastCheckAt = now
    // Offline or a flaky network rejects; there is nothing to do about it and the next check retries.
    registration.update().catch(() => undefined)
  }
  window.setInterval(check, CHECK_GAP_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
}

/**
 * Tells the store when a different worker takes over the page. The first takeover of a page that had no
 * worker (the first ever visit: `clientsClaim`) is not an update. This does not rely on workbox-window's
 * `controlling` event, which only counts as an update if the page was opened with a worker already.
 */
function watchForTakeover(): void {
  let controlled = navigator.serviceWorker.controller !== null
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) updateStore.markControlling()
    controlled = true
  })
}

/** Idempotent: React StrictMode mounts the host twice in development. */
export function registerServiceWorker(): void {
  // `vite dev` has no worker (devOptions are off) and a stale one would cache source files.
  if (started || import.meta.env.DEV || !('serviceWorker' in navigator)) return
  started = true
  watchForTakeover()
  const swapIn = registerSW({
    onNeedRefresh: () => updateStore.markWaiting(),
    // By default the helper reloads every open tab once a new worker takes over. Here only the tab where
    // "Reload" was tapped reloads (see `updateStore`), so a draft or a session in another tab is safe.
    onNeedReload: () => undefined,
    onRegisteredSW: (_url, registration) => {
      if (registration) watchForUpdates(registration)
    },
    onRegisterError: (error) => recordError(error, 'pwa.register'),
  })
  updateStore.attach(() => swapIn(true))
}
