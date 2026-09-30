import { recordError } from '@/app/reportError'
import { exportBackup, markBackedUp, type BackupExport } from '@/db/repos/backup'
import { downloadText } from '@/lib/download'
import { PREF_KEYS, removePref } from '@/lib/localPrefs'
import { formatMegabytes } from '@/logic/backup'
import { appVersion } from './appVersion'

export type BackupOutcome =
  { ok: true; filename: string; items: number; message: string } | { ok: false; message: string }

const JSON_MIME = 'application/json'

/** Saves a built export as a file. Nothing leaves the device. */
export function saveExport(out: BackupExport): void {
  downloadText(out.filename, out.json, JSON_MIME)
}

/** Reads every table, downloads `forge-backup-<day>.json` and records the time for the weekly reminder. */
export async function exportBackupFile(): Promise<BackupOutcome> {
  try {
    const now = Date.now()
    const out = await exportBackup(now, appVersion())
    saveExport(out)
    // The file is on its way; a failure to note the time must not turn a good backup into an error.
    await markBackedUp(now).catch((e: unknown) => recordError(e, 'markBackedUp'))
    const size = formatMegabytes(new Blob([out.json]).size)
    const skipped =
      out.file.notes.length > 0 ? ' Some attached files were left out (see the file’s notes).' : ''
    return {
      ok: true,
      filename: out.filename,
      items: out.items,
      message: `Saved ${out.filename} · ${out.items.toLocaleString('en-US')} items, ${size}.${skipped}`,
    }
  } catch (e) {
    recordError(e, 'exportBackup')
    return {
      ok: false,
      message: `Couldn’t export your data${e instanceof Error ? `: ${e.message}` : '.'}`,
    }
  }
}

/** Forgets every device-local preference (sidebar, layouts, half-finished drafts) after a reset. */
export function clearDevicePrefs(): void {
  for (const key of Object.values(PREF_KEYS)) removePref(key)
}
