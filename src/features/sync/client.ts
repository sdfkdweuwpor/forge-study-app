/**
 * The two things the engine and the Settings actions share: the `fetch` the transport sends with, and the
 * transport's view of the stored project. Lazy, like everything else here.
 */
import type { SyncStateRow } from '@/db/types'
import { parseApiKey, parseProjectUrl } from '@/logic/syncConfig'
import type { TransportConfig } from '@/logic/syncRequests'
import { createHttp, type Send } from './supabase/http'

/** The transport over the page's `fetch`: a 20 s timeout per call, `navigator.onLine` for the offline kind. */
export function browserSend(): Send {
  return createHttp({
    fetch: (url, init) => fetch(url, init),
    isOnline: () => navigator.onLine,
  })
}

/**
 * The stored project as the request builders want it, or null when there is none (or it no longer passes
 * the checks it passed when it was saved). The key kind decides whether the key may double as a bearer.
 */
export function transportOf(
  state: Pick<SyncStateRow, 'url' | 'anonKey'> | undefined,
): TransportConfig | null {
  if (!state?.url || !state.anonKey) return null
  const url = parseProjectUrl(state.url)
  if (!url.ok) return null
  const key = parseApiKey(state.anonKey, url.value.ref)
  if (!key.ok) return null
  return { url: url.value.url, anonKey: key.value.anonKey, keyKind: key.value.kind }
}
