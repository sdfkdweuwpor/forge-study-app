/**
 * The safety net's chores at app start: throw away Trash items whose 30 days are over (once a day) and
 * write the automatic daily snapshot (once a day, only when there is data). They run when the browser is
 * idle, a moment after the first paint, so they never compete with the interface or with the other
 * features' start-up work; a failure is logged and never reaches the person.
 */
import { recordError } from '@/app/reportError'
import { pruneSnapshots, runDailySnapshot } from '@/db/repos/snapshots'
import { purgeExpired } from '@/db/repos/trash'
import { whenIdle } from '@/lib/idle'
import { PREF_KEYS, readPref, writePref } from '@/lib/localPrefs'
import { clockJumpedForward, dailyDue } from '@/logic/retention'
import type { ISODate } from '@/db/types'
import { appVersion } from '@/lib/appVersion'

/** How long after start-up the chores wait, and the latest they may be put off when the browser is never idle. */
export const CHORE_DELAY_MS = 1500
export const CHORE_IDLE_TIMEOUT_MS = 15_000

function isDay(value: string | null): value is ISODate {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** The time of the previous start that ran this chore, or `null` (never, or not stored). */
function lastSeen(): number | null {
  const n = Number(readPref(PREF_KEYS.trashLastSeen))
  return readPref(PREF_KEYS.trashLastSeen) !== null && Number.isFinite(n) ? n : null
}

/**
 * Removes expired Trash items, once per local day. Returns how many went (0 when it did not run).
 *
 * The purge deletes for good, so a start whose clock is more than two days past the previous start's is
 * skipped (a device clock set years ahead would otherwise empty the Trash); it is done at the next start.
 * Someone back from a week away waits one start, which costs nothing: the items were due anyway.
 */
export async function purgeTrashDaily(now: number, today: ISODate): Promise<number> {
  const jumped = clockJumpedForward(lastSeen(), now)
  // Every start is noted, purged or not: the next one is compared with this one.
  writePref(PREF_KEYS.trashLastSeen, String(now))
  if (jumped) return 0
  const stored = readPref(PREF_KEYS.trashPurgedDay)
  if (!dailyDue(isDay(stored) ? stored : null, today)) return 0
  const removed = await purgeExpired(now)
  // Recorded after the purge, so a purge that failed is tried again at the next start.
  writePref(PREF_KEYS.trashPurgedDay, today)
  return removed
}

/** All the chores, one after the other, each failing on its own. */
export async function runSafetyChores(now: number, today: ISODate): Promise<void> {
  try {
    await purgeTrashDaily(now, today)
  } catch (e) {
    recordError(e, 'safety.purgeTrash')
  }
  try {
    await runDailySnapshot({ now, today, appVersion: appVersion() })
  } catch (e) {
    recordError(e, 'safety.dailySnapshot')
  }
  try {
    // Import and reset write their own safety copies without pruning; this keeps every kind to its limit.
    await pruneSnapshots()
  } catch (e) {
    recordError(e, 'safety.pruneSnapshots')
  }
}

let cancelPending: (() => void) | null = null

/** Schedules the chores for when the browser is idle (a second call, at midnight, replaces a pending one). */
export function scheduleSafetyChores({ now, today }: { now: number; today: ISODate }): void {
  cancelPending?.()
  cancelPending = whenIdle(
    () => {
      cancelPending = null
      void runSafetyChores(now, today)
    },
    { delayMs: CHORE_DELAY_MS, timeout: CHORE_IDLE_TIMEOUT_MS },
  )
}
