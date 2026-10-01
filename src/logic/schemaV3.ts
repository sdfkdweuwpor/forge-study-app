/**
 * Schema v3 row mapping (pure; PLAN §4.7.4): cloud sync. The only row change is that the settings row
 * loses `sync`, which moves to the device-local `syncState` table (a synced row cannot hold what a device
 * needs before it can sync). The Dexie upgrade (`db/migrations/v3.ts`) and the backup migrator
 * (`logic/backup.ts`) share it. Idempotent.
 */
import type { Millis } from '@/db/types'

type Row = Record<string, unknown>

/** A settings row without the v2 `sync` field. Anything that is not an object is returned as it is. */
export function settingsToV3<T>(input: T): T {
  if (typeof input !== 'object' || input === null || !('sync' in input)) return input
  const row: Row = { ...(input as Row) }
  delete row.sync
  return row as T
}

/** Tables a v3 backup never carries: this device's sync bookkeeping. */
export const V3_LOCAL_TABLES = ['syncOutbox', 'syncState'] as const

/** A v2 backup's tables as v3 tables: the settings row mapped, sync bookkeeping dropped if present. */
export function migrateTablesV2toV3(
  tables: Readonly<Record<string, readonly unknown[]>>,
  _now: Millis,
): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const [name, rows] of Object.entries(tables)) {
    if ((V3_LOCAL_TABLES as readonly string[]).includes(name)) continue
    out[name] = name === 'settings' ? rows.map(settingsToV3) : [...rows]
  }
  return out
}
