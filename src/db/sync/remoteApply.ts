/**
 * Transaction marks for cloud sync (PLAN §4.7.4). A Dexie transaction's `idbtrans` is the very object the
 * DBCore middleware receives as `req.trans` (and the timestamp hooks see as `tx.idbtrans`), so a WeakSet
 * keyed on it tells the tracking middleware which transactions to leave alone. `tracking.test.ts` guards
 * that identity.
 *
 * - untracked: the middleware queues nothing (a reset clearing this device only).
 * - remote apply: untracked, and the timestamp hooks keep the timestamps the rows arrive with (rows
 *   pulled from the server are written as they are).
 */
const untracked = new WeakSet<object>()
const remoteApply = new WeakSet<object>()

/** Marks a transaction (its `idbtrans`) so its writes are not queued for sync. */
export function markUntracked(idbtrans: object): void {
  untracked.add(idbtrans)
}

/** Marks a transaction as writing rows that came from the server: not queued, not re-stamped. */
export function markRemoteApply(idbtrans: object): void {
  untracked.add(idbtrans)
  remoteApply.add(idbtrans)
}

export function isUntracked(idbtrans: object | null | undefined): boolean {
  return idbtrans != null && untracked.has(idbtrans)
}

export function isRemoteApply(idbtrans: object | null | undefined): boolean {
  return idbtrans != null && remoteApply.has(idbtrans)
}
