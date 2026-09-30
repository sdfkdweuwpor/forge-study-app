/**
 * Snapshots (PLAN §3.5, Phase 11c): a copy of everything, kept inside IndexedDB, that can bring the data
 * back. One is taken automatically the first time Forge starts on a new day (the newest 7 are kept), one
 * on request ("Take snapshot now"), and one just before an import, a reset or a restore replaces the data
 * (the newest 5 of each kind are kept). Import and reset write theirs through `createSafetyCopy`
 * (`repos/backup.ts`); everything else about snapshots is here.
 *
 * A snapshot is a `BackupFile` written as JSON with **the bytes of attached files left out** (their rows are
 * listed; the counts say how many), gzip-compressed where the browser can. It never contains the
 * `snapshots` table. Restoring one therefore leaves the `files` table alone: attached PDFs that are still
 * on this device stay attached, and a resource whose file was deleted since shows "file missing".
 *
 * Nothing here blocks the interface: the read is one short read-only transaction, the JSON is written a
 * table at a time with the main thread handed back in between, compression runs in the browser's stream
 * threads, and the only write is one small row in `snapshots`.
 */
import { gunzipToText, gzipBlob } from '@/lib/gzip'
import { newId } from '@/lib/ids'
import { yieldToMain } from '@/lib/idle'
import { buildBackup, countItems, hasUserData, parseBackup, planRestore } from '@/logic/backup'
import { dayOf } from '@/logic/dates'
import { dailyDue, snapshotsToPrune } from '@/logic/retention'
import { filesInTrash, serializeInChunks } from '@/logic/snapshotJson'
import { db } from '../db'
import { SCHEMA_VERSION } from '../schema'
import type { ID, ISODate, Millis, Snapshot, SnapshotReason, StoredFile } from '../types'
import { BACKUP_CONTEXT, BACKUP_TABLES, readBackupTables } from './backup'
import { ensureSettings } from './settings'

/** A snapshot as the list shows it: everything but the data. */
export interface SnapshotInfo {
  id: ID
  createdAt: Millis
  day: ISODate
  reason: SnapshotReason
  schemaVersion: number
  /** What a download weighs (the JSON), whether or not it is stored compressed. */
  sizeBytes: number
  /** Rows per table when it was taken (settings excluded); `null` for a snapshot made before Phase 11c. */
  counts: Record<string, number> | null
}

export type SnapshotFailure = 'missing' | 'unreadable' | 'invalid'

/** A snapshot that cannot be read or restored. The message is written for the person. */
export class SnapshotError extends Error {
  readonly code: SnapshotFailure
  constructor(code: SnapshotFailure, message: string) {
    super(message)
    this.name = 'SnapshotError'
    this.code = code
  }
}

const infoOf = (s: Snapshot): SnapshotInfo => ({
  id: s.id,
  createdAt: s.createdAt,
  day: s.day,
  reason: s.reason,
  schemaVersion: s.schemaVersion,
  sizeBytes: s.sizeBytes,
  counts: s.counts ?? null,
})

/** Every snapshot, newest first. */
export async function listSnapshots(): Promise<SnapshotInfo[]> {
  const rows = await db.snapshots.orderBy('createdAt').reverse().toArray()
  return rows.map(infoOf)
}

/** The local day of the newest automatic snapshot, or `null` when there is none. */
export async function latestAutomaticDay(): Promise<ISODate | null> {
  const rows = await db.snapshots.where('reason').equals('daily').toArray()
  return rows.reduce<ISODate | null>(
    (best, s) => (best === null || s.day > best ? s.day : best),
    null,
  )
}

/** Deletes the snapshots each kind no longer keeps (7 automatic, 5 of every other kind). Returns how many went. */
export async function pruneSnapshots(): Promise<number> {
  return db.transaction('rw', db.snapshots, async () => {
    const doomed = snapshotsToPrune(await db.snapshots.toArray())
    if (doomed.length > 0) await db.snapshots.bulkDelete(doomed)
    return doomed.length
  })
}

export interface TakeSnapshotOptions {
  now: Millis
  appVersion: string
  /** Write nothing when there is nothing to lose (no task, goal, session… yet). The daily snapshot does. */
  skipIfEmpty?: boolean
}

/**
 * Writes a snapshot of every backup table (attached file bytes left out) and prunes old ones. Returns
 * `null` when `skipIfEmpty` and the app holds no data, or when another tab already wrote today's automatic one.
 */
export async function takeSnapshot(
  reason: SnapshotReason,
  opts: TakeSnapshotOptions,
): Promise<SnapshotInfo | null> {
  const { now, appVersion } = opts
  const tables = await readBackupTables()
  const counts: Record<string, number> = {}
  for (const [name, rows] of Object.entries(tables))
    if (name !== 'settings') counts[name] = rows.length
  if (opts.skipIfEmpty && !hasUserData(counts)) return null

  const file = await buildBackup({
    tables,
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    now,
    embedFiles: false,
  })
  const json = await serializeInChunks(file, yieldToMain)
  const source = new Blob([json], { type: 'application/json' })
  const gz = await gzipBlob(source)

  const row: Snapshot = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    day: dayOf(now),
    reason,
    schemaVersion: SCHEMA_VERSION,
    sizeBytes: source.size,
    data: gz ? '' : json,
    ...(gz ? { gz } : {}),
    counts,
  }
  const written = await db.transaction('rw', db.snapshots, async () => {
    // Two tabs starting together must not both write today's automatic snapshot.
    if (reason === 'daily') {
      const today = await db.snapshots
        .where('day')
        .equals(row.day)
        .filter((s) => s.reason === 'daily')
        .count()
      if (today > 0) return false
    }
    await db.snapshots.add(row)
    return true
  })
  if (!written) return null
  await pruneSnapshots()
  return infoOf(row)
}

/**
 * The automatic snapshot, when it is due: the newest one is from an earlier day and there is something
 * to save. Returns the snapshot, or `null` when nothing was written.
 */
export async function runDailySnapshot(opts: {
  now: Millis
  today: ISODate
  appVersion: string
}): Promise<SnapshotInfo | null> {
  if (!dailyDue(await latestAutomaticDay(), opts.today)) return null
  return takeSnapshot('daily', { now: opts.now, appVersion: opts.appVersion, skipIfEmpty: true })
}

/** The JSON of a snapshot, decompressed. Throws `SnapshotError` when it is missing or its bytes are not readable. */
export async function readSnapshotText(id: ID): Promise<string> {
  const row = await db.snapshots.get(id)
  if (!row) throw new SnapshotError('missing', 'That snapshot no longer exists.')
  if (!row.gz) return row.data
  try {
    return await gunzipToText(row.gz)
  } catch {
    throw new SnapshotError(
      'unreadable',
      'This snapshot’s data could not be read (the browser may have cleared part of it).',
    )
  }
}

export interface RestoreSnapshotResult {
  /** Rows written, not counting the settings row. */
  items: number
  /** The snapshot taken of the data as it was just before, so the restore can be undone. */
  preRestoreId: ID
  /** The data version the snapshot had before it was brought up to date. */
  fromVersion: number
}

/**
 * Replaces the app's data with a snapshot. In order: read and check the snapshot (a bad one stops here),
 * write a `pre-restore` snapshot of the data as it is (if that fails nothing is touched), then clear and
 * refill every backup table in ONE transaction (any failure rolls all of it back). The `files` table is left
 * as it is, because snapshots hold no file bytes (it only gains the bytes of files that were sitting in the
 * Trash, which the restore would otherwise lose); `snapshots` is left alone too. The caller reloads the
 * app afterwards so every screen starts from the restored data.
 */
export async function restoreSnapshot(
  id: ID,
  opts: { now: Millis; appVersion: string },
): Promise<RestoreSnapshotResult> {
  const text = await readSnapshotText(id)
  const parsed = parseBackup(text, BACKUP_CONTEXT)
  if (!parsed.ok) throw new SnapshotError('invalid', parsed.errors.join(' '))

  const safety = await takeSnapshot('pre-restore', { now: opts.now, appVersion: opts.appVersion })
  if (!safety)
    throw new SnapshotError(
      'unreadable',
      'Couldn’t save your current data first, so nothing was changed.',
    )

  const plan = planRestore(parsed.file, BACKUP_CONTEXT, opts.now)
  const replaced = BACKUP_TABLES.filter((name) => name !== 'files')
  await db.transaction('rw', [...replaced.map((name) => db.table(name)), db.files], async () => {
    // Deleting a PDF resource moves its file out of `files` into the Trash entry, and a snapshot's Trash
    // holds no bytes. Put the bytes of every trashed file back in `files` before the Trash is replaced, so
    // a later restore from the Trash (or Undo restore) still finds them through `resource.fileId`.
    const rescued = filesInTrash(await db.trash.toArray())
    if (rescued.length > 0) await db.files.bulkPut(rescued as unknown as StoredFile[])
    for (const name of replaced) {
      const table = db.table(name)
      await table.clear()
      const rows = plan.tables[name] ?? []
      if (rows.length > 0) await table.bulkPut(rows)
    }
  })
  await ensureSettings()
  const items = countItems({ ...plan.tables, files: [] })
  return { items, preRestoreId: safety.id, fromVersion: parsed.file.schemaVersion }
}
