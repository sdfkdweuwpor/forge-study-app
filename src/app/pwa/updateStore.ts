/**
 * Where the tab stands on a service worker update. A tiny external store: `register.ts` feeds it from the
 * worker's events, `UpdatePrompt` and the palette command read it.
 *
 * - `idle`: nothing newer is known.
 * - `waiting`: a newer worker is installed and waits for a tap on "Reload" (`registerType: 'prompt'`).
 * - `activated`: a newer worker already took control (another tab reloaded first), but this tab still
 *   runs the old code. It is never reloaded on its own: it may hold a draft or a running session.
 */

export type UpdatePhase = 'idle' | 'waiting' | 'activated'

export interface UpdateStoreDeps {
  reload: () => void
  /** Injectable for tests. */
  setTimer?: (fn: () => void, ms: number) => void
}

/** If nothing has reloaded the page this long after "Reload", it does so itself: a plain reload is always safe. */
export const APPLY_FALLBACK_MS = 4000

export interface UpdateStore {
  getPhase: () => UpdatePhase
  subscribe: (listener: () => void) => () => void
  /** Hands over the worker's `updateServiceWorker`, which tells the waiting worker to take over. */
  attach: (swapIn: () => Promise<void>) => void
  /** A newer worker is installed and waiting. */
  markWaiting: () => void
  /** The waiting worker took control. Reloads only when this tab asked for it. */
  markControlling: () => void
  /** The person chose "Reload". */
  apply: () => Promise<void>
}

export function createUpdateStore({
  reload,
  setTimer = (fn, ms) => void setTimeout(fn, ms),
}: UpdateStoreDeps): UpdateStore {
  let phase: UpdatePhase = 'idle'
  let swapIn: (() => Promise<void>) | null = null
  let applying = false
  const listeners = new Set<() => void>()

  const set = (next: UpdatePhase) => {
    if (next === phase) return
    phase = next
    for (const l of [...listeners]) l()
  }

  return {
    getPhase: () => phase,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    attach: (fn) => {
      swapIn = fn
    },
    markWaiting: () => {
      // "activated" is further along than "waiting"; never step back.
      if (phase === 'idle') set('waiting')
    },
    markControlling: () => {
      if (applying) reload()
      else set('activated')
    },
    apply: async () => {
      if (applying) return
      applying = true
      // Already swapped in elsewhere, or nothing to swap: a reload is all that is left.
      if (phase === 'activated' || swapIn === null) {
        reload()
        return
      }
      setTimer(reload, APPLY_FALLBACK_MS)
      try {
        await swapIn()
      } catch {
        // The fallback timer reloads anyway.
      }
    },
  }
}

export const updateStore: UpdateStore = createUpdateStore({
  reload: () => window.location.reload(),
})
