import { canAutoReload } from '@/logic/chunkError'

/** sessionStorage key of the last automatic reload, so a chunk that stays broken cannot cause a reload loop. */
const RELOAD_KEY = 'forge:chunk-reload-at'

/**
 * After a deploy an open tab can ask for a lazy chunk that no longer exists. A reload fetches the new
 * index.html and its chunks. Reloads automatically at most once per 30 s per tab; returns whether it did.
 * When storage is unavailable it never reloads on its own (it cannot prove it is not looping).
 */
export function reloadOnceForChunkError(): boolean {
  let last: number | null = null
  try {
    const raw = window.sessionStorage.getItem(RELOAD_KEY)
    last = raw === null ? null : Number(raw)
  } catch {
    return false
  }
  const now = Date.now()
  if (!canAutoReload(last, now)) return false
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(now))
  } catch {
    return false
  }
  window.location.reload()
  return true
}
