/**
 * Public API of the sync feature. Everything behind these calls is imported on demand: with sync off
 * nothing here loads, fetches or runs.
 */
import { syncIsOn } from './queries'

const engine = () => import('./engine')

/** Starts this tab's engine when sync is on (a second call does nothing). */
export async function startSyncEngine(): Promise<void> {
  if (syncIsOn()) (await engine()).startEngine()
}

/** Asks for a cycle now, from any tab: the one that syncs runs it. Does nothing while sync is off. */
export async function syncNow(): Promise<void> {
  if (syncIsOn()) (await engine()).startEngine().syncNow()
}
