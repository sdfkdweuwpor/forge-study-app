/**
 * What the Trash page, the Snapshots section and the palette do, without any React: each returns an
 * outcome the caller shows in a toast or a dialog. Failures are caught here and reported once to the
 * in-memory error log.
 */
import { recordError } from '@/app/reportError'
import {
  readSnapshotText,
  restoreSnapshot,
  takeSnapshot,
  type SnapshotInfo,
} from '@/db/repos/snapshots'
import { emptyTrash, purgeTrashItem, restoreTrashItem, type RestoreOutcome } from '@/db/repos/trash'
import { downloadText } from '@/lib/download'
import { snapshotFilename } from '@/logic/retention'
import { appVersion } from '@/lib/appVersion'
import { rememberRestore } from './restoreNotice'

const messageOf = (e: unknown): string =>
  e instanceof Error && e.message ? e.message : 'Something went wrong.'

// ─── Trash ──────────────────────────────────────────────────────────────────

/** Restores an entry (and its containers, see `restoreTrashItem`). Never throws. */
export async function restoreFromTrashPage(trashId: string): Promise<RestoreOutcome> {
  try {
    return await restoreTrashItem(trashId)
  } catch (e) {
    recordError(e, 'restoreTrashItem')
    return { ok: false, reason: 'failed', message: `Couldn’t restore it: ${messageOf(e)}` }
  }
}

export type SimpleOutcome = { ok: true } | { ok: false; message: string }

/** Deletes one entry for good. */
export async function deleteForever(trashId: string): Promise<SimpleOutcome> {
  try {
    await purgeTrashItem(trashId)
    return { ok: true }
  } catch (e) {
    recordError(e, 'purgeTrashItem')
    return { ok: false, message: `Couldn’t delete it: ${messageOf(e)}` }
  }
}

/** Deletes everything in the Trash for good. */
export async function emptyTheTrash(): Promise<
  { ok: true; count: number } | { ok: false; message: string }
> {
  try {
    return { ok: true, count: await emptyTrash() }
  } catch (e) {
    recordError(e, 'emptyTrash')
    return { ok: false, message: `Couldn’t empty the Trash: ${messageOf(e)}` }
  }
}

// ─── Snapshots ──────────────────────────────────────────────────────────────

export type SnapshotOutcome = { ok: true; info: SnapshotInfo } | { ok: false; message: string }

/** "Take snapshot now". */
export async function snapshotNow(): Promise<SnapshotOutcome> {
  try {
    const info = await takeSnapshot('manual', { now: Date.now(), appVersion: appVersion() })
    if (!info) return { ok: false, message: 'There was nothing to save.' }
    return { ok: true, info }
  } catch (e) {
    recordError(e, 'takeSnapshot')
    return { ok: false, message: `Couldn’t save a snapshot: ${messageOf(e)}` }
  }
}

/** Saves a snapshot's JSON as a file (attached PDFs are not in it). */
export async function downloadSnapshot(info: SnapshotInfo): Promise<SimpleOutcome> {
  try {
    const text = await readSnapshotText(info.id)
    downloadText(snapshotFilename(info.createdAt, info.reason), text, 'application/json')
    return { ok: true }
  } catch (e) {
    recordError(e, 'downloadSnapshot')
    return { ok: false, message: messageOf(e) }
  }
}

/**
 * Restores a snapshot and reloads the app. Resolves with an error message when it could not (nothing was
 * changed then); on success the page reloads and this never resolves to the caller.
 */
export async function restoreAndReload(
  id: string,
  takenAt: number,
  kind: 'restore' | 'undo' = 'restore',
): Promise<SimpleOutcome> {
  try {
    const result = await restoreSnapshot(id, { now: Date.now(), appVersion: appVersion() })
    rememberRestore({ kind, items: result.items, takenAt, preRestoreId: result.preRestoreId })
    window.location.reload()
    return { ok: true }
  } catch (e) {
    recordError(e, 'restoreSnapshot')
    return { ok: false, message: messageOf(e) }
  }
}
