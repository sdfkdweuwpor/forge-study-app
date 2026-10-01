import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/**
 * Whether the browser thinks it has a network (`navigator.onLine`). It is only a hint (it can say
 * "online" behind a dead captive portal), which is all the "Offline" pill needs: every byte of user
 * data is local, so nothing in the app depends on the answer.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}
