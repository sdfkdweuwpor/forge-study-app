/**
 * Palette commands and shortcuts have no React context, so they post a window event and `SafetyHost` (a
 * `global.overlays` slot) takes the snapshot and shows the toast. The host loads lazily, so a request made
 * before it is listening (`o s` right after the page opens) waits and runs the moment it is.
 */
export const SNAPSHOT_NOW_EVENT = 'forge:snapshot-now'

let hostListening = false
let queued = false

export function requestSnapshotNow(): void {
  if (hostListening) window.dispatchEvent(new Event(SNAPSHOT_NOW_EVENT))
  else queued = true
}

/** Called by the host: runs `run` for every request, including one that arrived before it was listening. */
export function listenForSnapshotNow(run: () => void): () => void {
  const onRequest = () => run()
  window.addEventListener(SNAPSHOT_NOW_EVENT, onRequest)
  hostListening = true
  if (queued) {
    queued = false
    run()
  }
  return () => {
    hostListening = false
    window.removeEventListener(SNAPSHOT_NOW_EVENT, onRequest)
  }
}
