/**
 * The app's one sync engine, wired to the real bridge, the database and the connection store.
 * `BlockerSync` drives it; the Blocker page's "Check again" calls `checkExtension()`.
 */
import { recordError } from '@/app/reportError'
import { markBlockerSynced, mergeBlockEvents, saveEventsCursor } from '@/db/repos/blocker'
import { getSettings } from '@/db/repos/settings'
import { ping, pullEvents, pushConfig, pushSession } from './bridge'
import { setConnected, setUnavailable } from './connection'
import { createSyncEngine } from './syncEngine'

export const syncEngine = createSyncEngine({
  ping: () => ping(),
  pushConfig: (config) => pushConfig(config),
  pushSession: (session) => pushSession(session),
  pullEvents: (since) => pullEvents(since),
  readCursor: async () => (await getSettings()).blocker.eventsCursor,
  storeEvents: async ({ events, cursor }) => {
    await mergeBlockEvents(events)
    await saveEventsCursor(cursor)
  },
  markSynced: () => markBlockerSynced(),
  now: () => Date.now(),
  setConnected,
  setUnavailable,
  report: (error, detail) => recordError(error, detail),
})

/** Asks the extension again (the page's "Check again"), then updates `useConnection()` with the answer. */
export async function checkExtension(): Promise<void> {
  await syncEngine.pull()
}
