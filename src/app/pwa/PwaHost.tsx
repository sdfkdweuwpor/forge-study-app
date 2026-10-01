import { useEffect } from 'react'
import { recordError } from '../reportError'

/** Registers the service worker after the first render and renders nothing. Slot `global.overlays`. */
export function PwaHost() {
  useEffect(() => {
    import('./register')
      .then((m) => m.registerServiceWorker())
      .catch((e: unknown) => recordError(e, 'pwa.load'))
  }, [])
  return null
}
