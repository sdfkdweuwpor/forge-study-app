/**
 * Which tab plays the ambient bed. Every open Forge tab sees the same running session, so without a
 * choice each one would start its own bed and they would pile up. One tab is elected with a Web Lock
 * (`navigator.locks`): the first tab that wants the bed while it is in front takes the lock and keeps it
 * for as long as it wants the bed, also once the person switches to another tab to study (the sound is
 * the point). Tabs that lose stay quiet and try again when they next come to the front, which is how a
 * bed moves on after the playing tab was closed. Without Web Locks every tab plays, as before.
 */

export const AMBIENT_LOCK = 'forge:ambient'

/** The part of `navigator.locks` used here, so a test can stand in for it. */
export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: object | null) => Promise<void> | undefined,
  ): Promise<unknown>
}

export interface ElectionDeps {
  locks: LockManagerLike | undefined
  isVisible(): boolean
  /** Calls `listener` whenever the tab may have come to the front; returns the unsubscribe function. */
  onVisible(listener: () => void): () => void
}

/**
 * Starts trying to become the tab that plays the bed. `onOwner(true)` is called once this tab holds the
 * lock (and at once when there is no lock manager), `onOwner(false)` when it lets go. Returns `stop`,
 * which releases the lock. Call it while the tab wants the bed, stop it when it does not.
 */
export function electAmbientOwner(
  deps: ElectionDeps,
  onOwner: (owner: boolean) => void,
): () => void {
  const { locks } = deps
  if (!locks) {
    onOwner(true)
    return () => onOwner(false)
  }

  let stopped = false
  let held = false
  let release: (() => void) | undefined

  const attempt = () => {
    if (stopped || held || !deps.isVisible()) return
    locks
      .request(AMBIENT_LOCK, { ifAvailable: true }, (lock) => {
        if (!lock || stopped || held) return undefined
        held = true
        onOwner(true)
        return new Promise<void>((resolve) => {
          release = resolve
        })
      })
      .catch(() => {
        // The lock manager refused (an opaque origin): better every tab plays than none.
        if (!stopped && !held) {
          held = true
          onOwner(true)
        }
      })
  }

  attempt()
  const off = deps.onVisible(attempt)
  return () => {
    stopped = true
    off()
    release?.()
    if (held) onOwner(false)
  }
}

/** The election's dependencies in the browser. */
export function browserElection(): ElectionDeps {
  return {
    locks: typeof navigator === 'undefined' ? undefined : navigator.locks,
    isVisible: () => document.visibilityState === 'visible',
    onVisible: (listener) => {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
  }
}
