/**
 * The one place the sync feature touches the Dexie instance: two reads of the tracker in `db`, which is
 * already part of the initial chunk. No I/O, and nothing else about sync is loaded by them.
 */
import { db } from '@/db/db'

/** Whether sync is on for this device. An in-memory flag, loaded when the database opens. */
export const syncIsOn = (): boolean => db.syncTracker.enabled

/** Calls `fn` after each write that was queued for sync (only while it is on). Returns the unsubscribe. */
export const onTrackedWrite = (fn: () => void): (() => void) => db.syncTracker.onTrackedWrite(fn)
