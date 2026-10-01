/**
 * Public API of the sync feature. Everything behind these calls is imported on demand: with sync off
 * nothing here loads, fetches or runs.
 */
import { syncIsOn } from './queries'

const engine = () => import('./engine')

/**
 * Starts this tab's engine when sync is on (a second call does nothing). `wrote`: a write of this tab is
 * why, and the engine did not hear it.
 */
export async function startSyncEngine(options: { wrote?: boolean } = {}): Promise<void> {
  if (syncIsOn()) (await engine()).startEngine(options)
}

/** Asks for a cycle now, from any tab: the one that syncs runs it. Does nothing while sync is off. */
export async function syncNow(): Promise<void> {
  if (syncIsOn()) (await engine()).startEngine().syncNow()
}
