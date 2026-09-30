/**
 * The start-up gate (PLAN §4.7.5): the daily plan roll-forward waits for the first sync of a page load,
 * so the device opened second each day usually adopts the first one's roll-forward (`lastDailyRunDay`
 * syncs) instead of computing its own.
 *
 * This file is in the entry chunk (the goals feature imports it), so it stays tiny and does no I/O: it
 * reads one in-memory flag, `db.syncTracker.enabled`, which is false whenever sync is off, and then the
 * gate resolves at once. Nothing else about sync is loaded. The sync engine settles the gate
 * (`settleStartupSync`) when its first cycle of the page load ends, whether it worked or not, and a
 * caller never waits longer than its timeout.
 */
import { db } from '../db'

let settled = false
const waiters = new Set<() => void>()

/**
 * Resolves when the first sync cycle of this page load has finished (or failed, or decided not to run),
 * or after `timeoutMs`, whichever comes first. Resolves at once when sync is off or the gate is already
 * settled. Never rejects.
 */
export function waitForStartupSync(timeoutMs = 8000): Promise<void> {
  if (settled || !db.syncTracker.enabled) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      waiters.delete(done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    waiters.add(done)
  })
}

/** The first cycle of this page load is over: everyone waiting goes on, and later calls return at once. */
export function settleStartupSync(): void {
  settled = true
  for (const done of [...waiters]) done()
}

/** Test helper: the next page load's gate (open again, nobody waiting). */
export function resetStartupSync(): void {
  settled = false
  for (const done of [...waiters]) done()
}
