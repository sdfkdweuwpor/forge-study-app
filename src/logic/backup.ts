/**
 * Backup files and snapshots across schema versions (pure; PLAN §3.4–3.5). JSON exports and in-DB
 * snapshots carry the `schemaVersion` they were written with; before an import or a restore they are
 * brought up to the current version one step at a time. Phase 10B adds the `BackupFile` Zod schema and
 * validation beside these migrators.
 */
import type { Millis } from '@/db/types'
import { migrateTablesV1toV2 } from './schemaV2'

/** The part of a backup file the migrators read and write. */
export interface VersionedTables {
  schemaVersion: number
  tables: Record<string, unknown[]>
}

/**
 * v1 → v2 (the planner schema, PLAN §4.6): the same row mapping as the Dexie upgrade. A file that is
 * not v1 is returned as it is. `now` stamps the planned assessments it adds.
 */
export function migrateBackupV1toV2<T extends VersionedTables>(file: T, now: Millis): T {
  if (file.schemaVersion !== 1) return file
  return { ...file, schemaVersion: 2, tables: migrateTablesV1toV2(file.tables, now) }
}

/** Every step from the file's version up to `target`. Newer files are returned unchanged. */
export function migrateBackup<T extends VersionedTables>(file: T, target: number, now: Millis): T {
  let out = file
  if (out.schemaVersion === 1 && target >= 2) out = migrateBackupV1toV2(out, now)
  return out
}
