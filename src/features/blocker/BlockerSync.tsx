/**
 * Keeps the extension and the app in step (PLAN §1.4). A feature provider: it renders its children
 * untouched and runs the sync alongside them.
 *
 * - The blocker config (blocklist, exceptions, mode, schedule, motivation) is pushed whenever it changes.
 * - The focus session is pushed on start, pause, resume and end, so focus-mode blocking follows the timer.
 * - Events (blocked attempts, unlocks) are pulled when the app starts, when the tab becomes visible
 *   again and every 60 seconds while it is.
 *
 * It is decoupled from the focus feature (it only reads the session row), silent when the extension
 * is not installed, and never throws.
 */
import { useEffect, type ReactNode } from 'react'
import { useBlockerConfig, useSessionState } from './queries'
import { syncEngine } from './sync'

export const PULL_INTERVAL_MS = 60_000

/** The sync itself; the manifest loads it after the first screen (see `feature.ts`). */
export function SyncRunner() {
  const config = useBlockerConfig()
  const session = useSessionState()

  useEffect(() => {
    if (config !== undefined) syncEngine.setConfig(config)
  }, [config])

  useEffect(() => {
    if (session !== undefined) syncEngine.setSession(session)
  }, [session])

  useEffect(() => {
    void syncEngine.pull()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncEngine.pull()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void syncEngine.pull()
    }, PULL_INTERVAL_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
      // Only when the provider goes away (or StrictMode re-runs the effects, which schedule again).
      syncEngine.cancelPending()
    }
  }, [])

  return null
}

export function BlockerSync({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SyncRunner />
    </>
  )
}
