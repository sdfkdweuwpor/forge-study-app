import { db } from '@/db/db'
import { buildBackup, serializeBackup, type BackupFile } from '@/logic/backup'
import { dayOf } from '@/logic/dates'
import { markTrashBlobs } from '@/logic/snapshotJson'

export interface ExportResult {
  filename: string
  tables: number
  rows: number
  /** Things the file does not contain (attached files left out because of their size). Empty for a complete export. */
  notes: string[]
}

/** Attached PDFs go into the dump (base64) only while they total no more than this; a bigger library is left out. */
export const FILES_EMBED_LIMIT_BYTES = 50 * 1024 * 1024

/**
 * What the crash screen exports: an ordinary backup file (the format Settings → Data imports, written by
 * the same `buildBackup` / `serializeBackup`), marked as coming from the crash screen. Every table is in
 * it except `snapshots` (the app's own safety copies, which stay on the device and are never part of a
 * backup), and its `notes` say what it leaves out.
 */
export interface RawDump extends BackupFile {
  kind: 'raw-dump'
}

/** The app's version (from package.json at build time), or "dev" where the build constant does not exist. */
const version = (): string => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev')

/**
 * Reads every table in ONE read transaction, so the dump is a consistent snapshot even while the app
 * keeps writing. It uses the Dexie instance and nothing else from the app, so it works when the rest of
 * the app is broken. Blob handles are collected inside the transaction, their bytes are read after it.
 */
export async function buildRawDump(
  now: number,
  embedLimitBytes: number = FILES_EMBED_LIMIT_BYTES,
): Promise<{ dump: RawDump; rows: number }> {
  const tables: Record<string, unknown[]> = {}
  const readable = db.tables.filter((t) => t.name !== 'snapshots')
  await db.transaction('r', readable, async () => {
    for (const table of readable) tables[table.name] = await table.toArray()
  })
  // A trashed resource carries its file inside the trash row; JSON cannot hold a Blob (it would write `{}`).
  if (tables.trash) tables.trash = markTrashBlobs(tables.trash)

  const file = await buildBackup({
    tables,
    schemaVersion: db.verno,
    appVersion: version(),
    now,
    // `buildBackup` embeds files that total *at most* the limit; the crash export's limit is exclusive.
    embedLimitBytes: embedLimitBytes - 1,
  })
  const rows = Object.values(file.tables).reduce((n, list) => n + list.length, 0)
  return { rows, dump: { ...file, kind: 'raw-dump' } }
}

/**
 * Everything to a JSON download. Used by the error screens, so it depends on nothing but the database and
 * works even when the rest of the app is broken. The file can be brought back with Settings → Data → Import.
 */
export async function exportAllData(): Promise<ExportResult> {
  const now = Date.now()
  const { dump, rows } = await buildRawDump(now)
  const json = serializeBackup(dump)
  const filename = `forge-export-${dayOf(now)}.json`
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { filename, tables: Object.keys(dump.tables).length, rows, notes: dump.notes }
}
