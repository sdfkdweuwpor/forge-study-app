/**
 * Backups (PLAN §3.5, Phase 10B): reading every table for a JSON export, replacing every table from a
 * backup file, and wiping the lot. The file format and its rules are pure and live in `logic/backup.ts`;
 * this file is only the database side.
 *
 * `snapshots` is the app's own safety net, so it is never part of a backup and an import or a reset never
 * clears it: the copy taken just before either one is written there first, and survives.
 */
import { newId } from '@/lib/ids'
import {
  backupReminderDue,
  buildBackup,
  hasUserData,
  planRestore,
  serializeBackup,
  backupFilename,
  countItems,
  safetyCopyFilename,
  type BackupContext,
  type BackupFile,
} from '@/logic/backup'
import { dayOf } from '@/logic/dates'
import { db } from '../db'
import { SCHEMA_VERSION, TABLE_NAMES, type TableName } from '../schema'
import type { Millis, Snapshot, SnapshotReason } from '../types'
import { ensureSettings, getSettings, updateSettings } from './settings'

/** Tables a backup carries and an import replaces. */
export const BACKUP_TABLES: readonly TableName[] = TABLE_NAMES.filter((t) => t !== 'snapshots')

/** What `logic/backup.ts` needs to know about this build's schema. */
export const BACKUP_CONTEXT: BackupContext = {
  currentVersion: SCHEMA_VERSION,
  knownTables: BACKUP_TABLES,
  ignoredTables: ['snapshots'],
}

/** Every backup table in ONE read transaction, so the copy is consistent while the app keeps writing. */
export async function readBackupTables(): Promise<Record<string, unknown[]>> {
  const tables: Record<string, unknown[]> = {}
  await db.transaction(
    'r',
    BACKUP_TABLES.map((name) => db.table(name)),
    async () => {
      for (const name of BACKUP_TABLES) tables[name] = await db.table(name).toArray()
    },
  )
  return tables
}

export interface BackupExport {
  file: BackupFile
  /** The file's text, ready to download. */
  json: string
  filename: string
  /** Rows in the file, not counting the settings row. */
  items: number
}

/** Reads everything and builds the export. Does not record it as done: call `markBackedUp` after saving. */
export async function exportBackup(now: Millis, appVersion: string): Promise<BackupExport> {
  const tables = await readBackupTables()
  const file = await buildBackup({ tables, schemaVersion: SCHEMA_VERSION, appVersion, now })
  return {
    file,
    json: serializeBackup(file),
    filename: backupFilename(now),
    items: countItems(file.tables),
  }
}

/** Records that a full backup was just saved (the weekly reminder counts from here). */
export async function markBackedUp(now: Millis): Promise<void> {
  await updateSettings({ backup: { lastExportAt: now } })
}

/** Records that the weekly reminder has just been shown. */
export async function markReminded(now: Millis): Promise<void> {
  await updateSettings({ backup: { lastRemindedAt: now } })
}

/** Row count of every backup table. */
export async function countRows(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  await Promise.all(
    BACKUP_TABLES.map(async (name) => {
      counts[name] = await db.table(name).count()
    }),
  )
  return counts
}

/** Whether the weekly "back up now?" nudge should show right now (see `backupReminderDue`). */
export async function isBackupReminderDue(now: Millis): Promise<boolean> {
  const settings = await getSettings()
  const { lastExportAt, lastRemindedAt, remindWeekly } = settings.backup
  // Cheap checks first: the row counts are only read when the rest says yes.
  const base = { now, lastExportAt, lastRemindedAt, remindWeekly, since: settings.createdAt }
  if (!backupReminderDue({ ...base, hasData: true })) return false
  return backupReminderDue({ ...base, hasData: hasUserData(await countRows()) })
}

// ─── Safety copies ──────────────────────────────────────────────────────────

export interface SafetyCopy {
  /** Every table plus attached files, for the person to keep as a file. */
  download: BackupExport
  snapshotId: string
}

/**
 * The copy taken before an import or a reset replaces everything: one row in `snapshots` (JSON without
 * attached files, like every snapshot) and a full export the caller can offer as a download. Nothing
 * else changes, so if this fails the caller stops and the data is untouched.
 */
export async function createSafetyCopy(
  reason: Extract<SnapshotReason, 'pre-import' | 'pre-reset'>,
  now: Millis,
  appVersion: string,
): Promise<SafetyCopy> {
  const tables = await readBackupTables()
  const withFiles = await buildBackup({ tables, schemaVersion: SCHEMA_VERSION, appVersion, now })
  const lean = await buildBackup({
    tables,
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    now,
    embedFiles: false,
  })
  const data = serializeBackup(lean, false)
  const snapshot: Snapshot = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    day: dayOf(now),
    reason,
    schemaVersion: SCHEMA_VERSION,
    sizeBytes: new Blob([data]).size,
    data,
  }
  await db.snapshots.add(snapshot)
  return {
    snapshotId: snapshot.id,
    download: {
      file: withFiles,
      json: serializeBackup(withFiles),
      filename: safetyCopyFilename(now),
      items: countItems(withFiles.tables),
    },
  }
}

// ─── Replace and reset ──────────────────────────────────────────────────────

export interface ImportResult {
  /** Rows written, not counting the settings row. */
  items: number
  /** Attached files that had no bytes in the backup and were left out. */
  skippedFiles: number
  /** The data version the file had before it was brought up to date. */
  fromVersion: number
}

/**
 * Replaces every backup table with the file's rows in ONE transaction: if any write fails (a row that
 * cannot be stored, no room left) the whole thing is rolled back and the data is exactly as it was.
 * The file is migrated to this build's schema first, and the settings row is completed with any keys
 * the backup predates. `snapshots` is left alone.
 */
export async function importBackup(file: BackupFile, now: Millis): Promise<ImportResult> {
  const plan = planRestore(file, BACKUP_CONTEXT, now)
  await db.transaction(
    'rw',
    BACKUP_TABLES.map((name) => db.table(name)),
    async () => {
      for (const name of BACKUP_TABLES) {
        const table = db.table(name)
        await table.clear()
        const rows = plan.tables[name] ?? []
        if (rows.length > 0) await table.bulkPut(rows)
      }
    },
  )
  await ensureSettings()
  return {
    items: countItems(plan.tables),
    skippedFiles: plan.skippedFiles,
    fromVersion: file.schemaVersion,
  }
}

/** Empties every backup table in one transaction and makes sure the settings row exists again. */
export async function resetAllData(): Promise<void> {
  await db.transaction(
    'rw',
    BACKUP_TABLES.map((name) => db.table(name)),
    async () => {
      for (const name of BACKUP_TABLES) await db.table(name).clear()
    },
  )
  await ensureSettings()
}
