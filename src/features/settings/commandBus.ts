/**
 * Palette commands and shortcuts have no React context, so they post a window event and `SettingsHost`
 * (a `global.overlays` slot) runs the export and shows the toast. The host loads lazily, so a request
 * made before it is listening (`o b` right after the page opens) waits and runs the moment it is.
 * Import and reset are dialogs on the Settings page: their commands go there with `?do=import` or
 * `?do=reset`.
 */
export const BACKUP_EXPORT_EVENT = 'forge:backup-export'

let hostListening = false
let queued = false

export function requestBackupExport(): void {
  if (hostListening) window.dispatchEvent(new Event(BACKUP_EXPORT_EVENT))
  else queued = true
}

/** Called by the host: runs `run` for every request, including one that arrived before it was listening. */
export function listenForBackupExport(run: () => void): () => void {
  const onRequest = () => run()
  window.addEventListener(BACKUP_EXPORT_EVENT, onRequest)
  hostListening = true
  if (queued) {
    queued = false
    run()
  }
  return () => {
    hostListening = false
    window.removeEventListener(BACKUP_EXPORT_EVENT, onRequest)
  }
}
