import { useCallback, useEffect, useState } from 'react'
import { recordError } from '../reportError'
import type { SearchProvider } from '../registry/types'
import { LIMITS, type ProviderResults } from './paletteModel'

/** A pause after the last keystroke before the providers are asked (they read IndexedDB). */
export const SEARCH_DEBOUNCE_MS = 120

interface Settled {
  query: string
  providers: ProviderResults[]
  /** Every provider failed. One failing among several just leaves its group out. */
  failed: boolean
}

export interface ProviderSearch {
  /** Results for the newest query that has finished. While a newer one is pending these stay (stale) so the list does not blink. */
  providers: readonly ProviderResults[]
  /** A search for the current query has not finished yet. */
  pending: boolean
  /** The search for the current query failed everywhere. */
  failed: boolean
  retry: () => void
}

/**
 * Debounced search across every registered provider. Providers run in parallel; a failure is logged
 * and shows as `failed` only when they all failed. A late answer for an older query is dropped.
 */
export function useProviderSearch(
  providers: readonly SearchProvider[],
  query: string,
  enabled: boolean,
): ProviderSearch {
  const q = query.trim()
  const active = enabled && q !== '' && providers.length > 0
  const [settled, setSettled] = useState<Settled | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Forget results when the palette closes (reset while rendering; nothing outside React changes).
  if (!enabled && settled !== null) setSettled(null)

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    const timer = window.setTimeout(() => {
      // `Promise.resolve().then` also turns a provider that throws synchronously into a rejection.
      const runs = providers.map((p) => Promise.resolve().then(() => p.search(q, LIMITS.results)))
      void Promise.allSettled(runs).then((outcomes) => {
        if (cancelled) return
        const found: ProviderResults[] = []
        let failures = 0
        outcomes.forEach((outcome, i) => {
          const provider = providers[i]
          if (!provider) return
          if (outcome.status === 'fulfilled') {
            found.push({ providerId: provider.id, group: provider.group, results: outcome.value })
          } else {
            failures += 1
            recordError(outcome.reason, `palette.search:${provider.id}`)
          }
        })
        setSettled({ query: q, providers: found, failed: failures === providers.length })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active, providers, q, attempt])

  const retry = useCallback(() => {
    setSettled(null)
    setAttempt((n) => n + 1)
  }, [])

  const fresh = active && settled !== null && settled.query === q
  return {
    providers: active && settled ? settled.providers : [],
    pending: active && !fresh,
    failed: fresh && settled.failed,
    retry,
  }
}
