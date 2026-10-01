/**
 * Backup files and snapshots across schema versions (pure; PLAN §3.4–3.5). JSON exports and in-DB
 * snapshots carry the `schemaVersion` they were written with; before an import or a restore they are
 * brought up to the current version one step at a time.
 *
 * This file is the whole file format: building a `BackupFile` from table rows (attached PDFs become
 * base64 up to a limit), reading one back with clear errors, migrating it, counting what is inside
 * for the import preview, and the small rules around the weekly backup reminder and the typed reset.
 * Nothing here touches the database; `db/repos/backup.ts` does the reads and the replace.
 */
import type { Millis } from '@/db/types'
import { dayOf, diffDays } from './dates'
import { migrateTablesV1toV2 } from './schemaV2'
import { migrateTablesV2toV3 } from './schemaV3'
import { markTrashBlobs, withoutMarkedTrashFiles } from './snapshotJson'
import { SYNC_BOOKKEEPING_TABLES } from './syncTables'

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

/**
 * v2 → v3 (cloud sync, PLAN §4.7.4): the settings row loses `sync`, and this device's sync bookkeeping
 * is never carried. A file that is not v2 is returned as it is.
 */
export function migrateBackupV2toV3<T extends VersionedTables>(file: T, now: Millis): T {
  if (file.schemaVersion !== 2) return file
  return { ...file, schemaVersion: 3, tables: migrateTablesV2toV3(file.tables, now) }
}

/** Every step from the file's version up to `target`. Newer files are returned unchanged. */
export function migrateBackup<T extends VersionedTables>(file: T, target: number, now: Millis): T {
  let out = file
  if (out.schemaVersion === 1 && target >= 2) out = migrateBackupV1toV2(out, now)
  if (out.schemaVersion === 2 && target >= 3) out = migrateBackupV2toV3(out, now)
  return out
}

// ─── The file ───────────────────────────────────────────────────────────────

export const BACKUP_APP = 'forge'
export const BACKUP_FORMAT = 1

/** Attached files go into a backup (base64) only while they total no more than this. */
export const FILES_EMBED_LIMIT_BYTES = 50 * 1024 * 1024

/** A stored file's bytes as they appear in the JSON (the `blob` field of a `files` row). */
export interface EncodedBlob {
  __blob: true
  type: string
  size: number
  /** Absent when the bytes were left out. */
  base64?: string
}

export interface BackupFile extends VersionedTables {
  app: typeof BACKUP_APP
  format: typeof BACKUP_FORMAT
  appVersion: string
  /** ISO 8601. */
  exportedAt: string
  /** Things a reader should know the file does not contain. */
  notes: string[]
}

export function isEncodedBlob(value: unknown): value is EncodedBlob {
  return (
    isPlainObject(value) &&
    value.__blob === true &&
    typeof value.type === 'string' &&
    typeof value.size === 'number'
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ─── Bytes ↔ base64 ─────────────────────────────────────────────────────────

const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function encodeBlob(blob: Blob, embed: boolean): Promise<EncodedBlob> {
  const marker: EncodedBlob = { __blob: true, type: blob.type, size: blob.size }
  if (!embed) return marker
  return { ...marker, base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) }
}

/** "12.3 MB". */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Building ───────────────────────────────────────────────────────────────

export interface BuildBackupInput {
  /** Rows by table, straight from the database (`files` rows still hold their Blob). */
  tables: Readonly<Record<string, readonly unknown[]>>
  schemaVersion: number
  appVersion: string
  now: Millis
  /** false leaves every attached file's bytes out (snapshots do this). Default true. */
  embedFiles?: boolean
  /** Total size of attached files above which none are embedded. Default 50 MB. */
  embedLimitBytes?: number
}

interface FileRow {
  blob: Blob
}

const hasBlob = (row: unknown): row is FileRow =>
  isPlainObject(row) && typeof Blob !== 'undefined' && row.blob instanceof Blob

const BOOKKEEPING: ReadonlySet<string> = new Set(SYNC_BOOKKEEPING_TABLES)

/**
 * Turns table rows into a `BackupFile`. Attached files are the only rows JSON cannot hold: they are
 * embedded as base64 when together they fit the limit, otherwise every file is listed without its bytes
 * and a note says so.
 *
 * This device's sync bookkeeping (`syncState` holds the session's tokens) never goes into a file, even
 * from a caller that reads every table (the crash screen's export): its rows are written as empty lists.
 */
export async function buildBackup(input: BuildBackupInput): Promise<BackupFile> {
  const { tables, schemaVersion, appVersion, now } = input
  const limit = input.embedLimitBytes ?? FILES_EMBED_LIMIT_BYTES
  const out: Record<string, unknown[]> = {}
  for (const [name, rows] of Object.entries(tables))
    out[name] = BOOKKEEPING.has(name) ? [] : [...rows]

  const notes: string[] = []
  const files = (out.files ?? []).filter(hasBlob)
  if (files.length > 0) {
    const total = files.reduce((sum, f) => sum + f.blob.size, 0)
    const wanted = input.embedFiles ?? true
    const embed = wanted && total <= limit
    if (wanted && !embed) {
      notes.push(
        `Attached files (${files.length}, ${formatMegabytes(total)}) are listed without their contents because together they exceed the ${formatMegabytes(limit)} limit for a backup file.`,
      )
    } else if (!wanted) {
      notes.push(`Attached files (${files.length}) are listed without their contents.`)
    }
    out.files = await Promise.all(
      (out.files ?? []).map(async (row) =>
        hasBlob(row) ? { ...row, blob: await encodeBlob(row.blob, embed) } : row,
      ),
    )
  }

  // A trashed resource carries its attached file inside the trash row's payload. JSON cannot hold a Blob
  // (it would write `{}`), so it is listed the way the `files` table lists a file it left out.
  if (out.trash) out.trash = markTrashBlobs(out.trash)

  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    schemaVersion,
    appVersion,
    exportedAt: new Date(now).toISOString(),
    notes,
    tables: out,
  }
}

export function serializeBackup(file: BackupFile, pretty = true): string {
  return JSON.stringify(file, null, pretty ? 2 : undefined)
}

/** `forge-backup-2026-09-29.json` (local day). */
export function backupFilename(now: Millis): string {
  return `forge-backup-${dayOf(now)}.json`
}

/** The copy taken before an import replaces everything. */
export function safetyCopyFilename(now: Millis): string {
  return `forge-before-import-${dayOf(now)}.json`
}

// ─── Reading ────────────────────────────────────────────────────────────────

export interface BackupContext {
  /** The schema version this build writes; a newer file is refused. */
  currentVersion: number
  /** Every table this build knows, in schema order. */
  knownTables: readonly string[]
  /** Tables a backup never carries and an import never touches (`snapshots`). */
  ignoredTables?: readonly string[]
}

export type BackupParseResult =
  { ok: true; file: BackupFile; warnings: string[] } | { ok: false; errors: string[] }

/** How many row problems are listed before "and N more". */
const MAX_LISTED = 5

const JSON_HINT = 'Choose a file made by Export all data (forge-backup-….json).'

/** Reads and checks the text of a chosen file. Never throws. */
export function parseBackup(text: string, ctx: BackupContext): BackupParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return {
      ok: false,
      errors: [
        text.trim() === ''
          ? 'That file is empty.'
          : `That isn’t a readable JSON file. It may be cut off or not a backup at all. ${JSON_HINT}`,
      ],
    }
  }
  return validateBackup(value, ctx)
}

/** Checks the shape and version of an already-parsed value. Never throws. */
export function validateBackup(value: unknown, ctx: BackupContext): BackupParseResult {
  if (!isPlainObject(value)) {
    return { ok: false, errors: [`That file doesn’t hold a Forge backup. ${JSON_HINT}`] }
  }
  if (value.app !== BACKUP_APP) {
    return {
      ok: false,
      errors: [`That file wasn’t made by Forge (it has no "app": "forge" marker). ${JSON_HINT}`],
    }
  }
  // The crash screen's raw dump is a backup too, minus a format number.
  const rawDump = value.kind === 'raw-dump'
  if (!(value.format === BACKUP_FORMAT || (rawDump && value.format === undefined))) {
    return {
      ok: false,
      errors: [
        typeof value.format === 'number' && value.format > BACKUP_FORMAT
          ? 'That backup uses a newer file format than this version of Forge understands. Update Forge and try again.'
          : 'That backup has an unknown file format.',
      ],
    }
  }
  const version = value.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, errors: ['That backup has no valid data version (schemaVersion).'] }
  }
  if (version > ctx.currentVersion) {
    return {
      ok: false,
      errors: [
        `That backup was made by a newer version of Forge (data version ${version}; this one reads up to ${ctx.currentVersion}). Update Forge, then import it.`,
      ],
    }
  }
  const exportedAt = typeof value.exportedAt === 'string' ? value.exportedAt : ''
  if (exportedAt === '' || Number.isNaN(Date.parse(exportedAt))) {
    return { ok: false, errors: ['That backup has no valid export date (exportedAt).'] }
  }
  if (!isPlainObject(value.tables)) {
    return { ok: false, errors: ['That backup has no tables, so there is nothing to import.'] }
  }

  const known = new Set(ctx.knownTables)
  const ignored = new Set(ctx.ignoredTables ?? [])
  const errors: string[] = []
  const warnings: string[] = []
  const unknown: string[] = []
  const tables: Record<string, unknown[]> = {}

  for (const [name, rows] of Object.entries(value.tables)) {
    if (ignored.has(name)) continue
    if (!known.has(name)) {
      unknown.push(name)
      continue
    }
    if (!Array.isArray(rows)) {
      errors.push(`The “${name}” table isn’t a list.`)
      continue
    }
    const isBad = (r: unknown) => !isPlainObject(r) || typeof r.id !== 'string' || r.id === ''
    const bad = rows.findIndex(isBad)
    if (bad !== -1) {
      const more = rows.filter(isBad).length - 1
      errors.push(
        `“${name}” row ${bad + 1} has no id${more > 0 ? `, and ${more} more like it` : ''}.`,
      )
      continue
    }
    tables[name] = rows
  }
  if (errors.length > 0) {
    return {
      ok: false,
      errors: [
        ...errors.slice(0, MAX_LISTED),
        ...(errors.length > MAX_LISTED
          ? [`…and ${errors.length - MAX_LISTED} more problems.`]
          : []),
      ],
    }
  }
  if (unknown.length > 0) {
    warnings.push(
      `Left out ${unknown.length === 1 ? 'a table' : `${unknown.length} tables`} this version of Forge doesn’t have: ${unknown.slice(0, MAX_LISTED).join(', ')}.`,
    )
  }
  if (countItems(tables) === 0) {
    return {
      ok: false,
      errors: ['That backup is empty, so importing it would only erase what you have now.'],
    }
  }

  const notes = Array.isArray(value.notes)
    ? value.notes.filter((n): n is string => typeof n === 'string')
    : []
  return {
    ok: true,
    warnings,
    file: {
      app: BACKUP_APP,
      format: BACKUP_FORMAT,
      schemaVersion: version,
      appVersion: typeof value.appVersion === 'string' ? value.appVersion : 'unknown',
      exportedAt,
      notes,
      tables,
    },
  }
}

// ─── The preview ────────────────────────────────────────────────────────────

/** Rows in the file, not counting the single settings row (those are "items"). */
export function countItems(tables: Readonly<Record<string, readonly unknown[]>>): number {
  let n = 0
  for (const [name, rows] of Object.entries(tables)) if (name !== 'settings') n += rows.length
  return n
}

export interface BackupSummary {
  exportedAt: Millis
  appVersion: string
  schemaVersion: number
  /** Rows minus the settings row. */
  items: number
  /** Non-empty tables in schema order (settings excluded). */
  counts: { table: string; count: number }[]
  /** The file is older than this build and will be upgraded while it is imported. */
  needsUpgrade: boolean
}

export function summarizeBackup(file: BackupFile, ctx: BackupContext): BackupSummary {
  const counts = ctx.knownTables
    .filter((t) => t !== 'settings')
    .map((table) => ({ table, count: file.tables[table]?.length ?? 0 }))
    .filter((c) => c.count > 0)
  return {
    exportedAt: Date.parse(file.exportedAt),
    appVersion: file.appVersion,
    schemaVersion: file.schemaVersion,
    items: countItems(file.tables),
    counts,
    needsUpgrade: file.schemaVersion < ctx.currentVersion,
  }
}

// ─── Restoring ──────────────────────────────────────────────────────────────

export interface RestorePlan {
  /** Every table of the current schema, migrated, with attached files turned back into Blobs. */
  tables: Record<string, unknown[]>
  /** Attached files whose bytes were not in the backup; they cannot be restored and are dropped. */
  skippedFiles: number
}

/**
 * The rows an import will write: the file migrated to `ctx.currentVersion`, its attached files decoded
 * to Blobs, and every known table present (an absent one is empty).
 */
export function planRestore(file: BackupFile, ctx: BackupContext, now: Millis): RestorePlan {
  const migrated = migrateBackup(file, ctx.currentVersion, now)
  const tables: Record<string, unknown[]> = {}
  for (const name of ctx.knownTables) tables[name] = [...(migrated.tables[name] ?? [])]

  // Trashed files were never in a backup (see `buildBackup`): an entry restores without them.
  if (tables.trash) tables.trash = withoutMarkedTrashFiles(tables.trash)

  let skippedFiles = 0
  tables.files = (tables.files ?? []).flatMap((row) => {
    if (!isPlainObject(row)) return []
    const blob = row.blob
    if (blob instanceof Blob) return [row]
    if (isEncodedBlob(blob) && typeof blob.base64 === 'string') {
      try {
        return [{ ...row, blob: new Blob([base64ToBytes(blob.base64)], { type: blob.type }) }]
      } catch {
        // Not valid base64: treat the bytes as missing.
      }
    }
    skippedFiles += 1
    return []
  })
  return { tables, skippedFiles }
}

// ─── Weekly reminder, reset ─────────────────────────────────────────────────

/** A backup older than this many days is "a week old". */
export const BACKUP_REMINDER_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

export interface ReminderInput {
  now: Millis
  /** When the data was last exported; null when it never was. */
  lastExportAt: Millis | null
  /** When the reminder last showed; null when it never did. */
  lastRemindedAt: Millis | null
  /** The settings switch. */
  remindWeekly: boolean
  /** The person has entered anything worth backing up. */
  hasData: boolean
  /** When there is no export yet, the age is counted from here (the day Forge was first opened). */
  since: Millis
}

/**
 * Whether to show "It’s been a week since your last backup". Only for someone who has data and has not
 * switched it off, only when the last export (or, before the first one, the first day of use) is more
 * than 7 days ago, and never twice inside a week, whether or not the first was acted on.
 */
export function backupReminderDue(i: ReminderInput): boolean {
  if (!i.remindWeekly || !i.hasData) return false
  const week = BACKUP_REMINDER_DAYS * DAY_MS
  if (i.now - (i.lastExportAt ?? i.since) <= week) return false
  return i.lastRemindedAt === null || i.now - i.lastRemindedAt >= week
}

/** Tables whose rows the person creates; the seeded blocklist and starter rewards do not count. */
export const USER_DATA_TABLES = [
  'tasks',
  'goals',
  'sessions',
  'flashcards',
  'resources',
  'parkingLot',
  'checkIns',
  'assessments',
] as const

/** True when any table a person fills has a row. */
export function hasUserData(counts: Readonly<Record<string, number>>): boolean {
  return USER_DATA_TABLES.some((t) => (counts[t] ?? 0) > 0)
}

/** "Never", "Today", "Yesterday", "5 days ago" (calendar days in the local time zone). */
export function backupAgeLabel(lastExportAt: Millis | null, now: Millis): string {
  if (lastExportAt === null) return 'Never'
  const days = diffDays(dayOf(now), dayOf(lastExportAt))
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

/** What has to be typed to confirm a reset. */
export const RESET_PHRASE = 'reset forge'

/** Case and surrounding spaces do not matter; the words do. */
export function isResetPhrase(input: string): boolean {
  return input.trim().toLowerCase() === RESET_PHRASE
}
