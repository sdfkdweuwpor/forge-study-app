/**
 * Schema v3: cloud sync (PLAN §4.7.4).
 * - new tables: `syncOutbox` (one entry per record changed since the last push, keyed `[tbl+id]`, indexed
 *   by its stamp `at`) and `syncState` (this device's sync config and bookkeeping, one row `'device'`).
 * - settings: `sync` moves out of the row (to `syncState`).
 * Nothing is written to the new tables: with no `syncState` row sync is off, and a migration is not an
 * edit, so the upgrade queues nothing (it runs in the native versionchange transaction, which the
 * tracking middleware never sees). The row mapping is pure and shared with the backup migrator
 * (`@/logic/schemaV3`).
 */
import type { Transaction } from 'dexie'
import { settingsToV3 } from '@/logic/schemaV3'

/** Only the stores that change in v3. */
export const STORES_V3_DELTA = {
  syncOutbox: '[tbl+id], at',
  syncState: 'id',
} as const

type Row = Record<string, unknown>

export async function upgradeV3(tx: Transaction): Promise<void> {
  // Only rows that still carry `sync` are written, so running it again touches nothing.
  await tx
    .table('settings')
    .toCollection()
    .filter((row: Row) => settingsToV3(row) !== row)
    .modify((row: Row) => {
      delete row.sync
    })
}
