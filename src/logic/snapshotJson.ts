/**
 * Pieces of writing and reading a snapshot's JSON that need no database (pure; Phase 11c):
 *
 *  - `serializeInChunks` writes a backup file table by table, giving the main thread back between tables,
 *    so a year of study never becomes one long task. Its output is `JSON.stringify(file)`, byte for byte;
 *  - a trashed resource carries its attached file (a Blob) inside the trash row's payload. JSON cannot hold
 *    it, and `JSON.stringify` would turn it into `{}`, so `markTrashBlobs` writes the same
 *    `{ __blob, type, size }` marker the `files` table gets, and `withoutMarkedTrashFiles` drops those rows
 *    again when a snapshot is restored (the bytes were never in it).
 */
import type { BackupFile } from './backup'

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** `JSON.stringify(file)`, written one table at a time with `yieldNow` awaited between the tables. */
export async function serializeInChunks(
  file: BackupFile,
  yieldNow: () => Promise<void>,
): Promise<string> {
  const keys = Object.keys(file)
  // Only the layout `buildBackup` produces (`tables` last) can be joined by hand; anything else is stringified whole.
  if (keys.at(-1) !== 'tables') return JSON.stringify(file)
  const { tables, ...head } = file
  const parts: string[] = []
  for (const [name, rows] of Object.entries(tables)) {
    parts.push(`${JSON.stringify(name)}:${JSON.stringify(rows)}`)
    await yieldNow()
  }
  return `${JSON.stringify(head).slice(0, -1)},"tables":{${parts.join(',')}}}`
}

/** The marker standing in for a file's bytes. */
function blobMarker(blob: Blob): { __blob: true; type: string; size: number } {
  return { __blob: true, type: blob.type, size: blob.size }
}

/** Trash rows with every attached file's Blob inside a payload replaced by its marker (other rows are untouched). */
export function markTrashBlobs(rows: readonly unknown[]): unknown[] {
  return rows.map((row) => {
    if (!isRow(row) || !isRow(row.payload) || !Array.isArray(row.payload.files)) return row
    const files = row.payload.files.map((f) =>
      isRow(f) && typeof Blob !== 'undefined' && f.blob instanceof Blob
        ? { ...f, blob: blobMarker(f.blob) }
        : f,
    )
    return { ...row, payload: { ...row.payload, files } }
  })
}

/**
 * Trash rows without the payload files whose bytes are not real: a marker, or the `{}` an older export made
 * of a Blob. Restoring such a file would bring back a row whose PDF cannot be opened; the resource that
 * points at it shows "file missing" instead.
 */
export function withoutMarkedTrashFiles(rows: readonly unknown[]): unknown[] {
  return rows.map((row) => {
    if (!isRow(row) || !isRow(row.payload) || !Array.isArray(row.payload.files)) return row
    const files = row.payload.files.filter(
      (f) => !isRow(f) || (typeof Blob !== 'undefined' && f.blob instanceof Blob),
    )
    if (files.length === row.payload.files.length) return row
    return { ...row, payload: { ...row.payload, files } }
  })
}

/**
 * The attached files whose real bytes sit inside trash rows. `moveToTrash` takes a trashed resource's file
 * out of `files` and into its entry's payload, and a snapshot only ever holds a marker for it, so when a
 * restore replaces the Trash these rows are the only copy of the bytes.
 */
export function filesInTrash(rows: readonly unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const row of rows) {
    if (!isRow(row) || !isRow(row.payload) || !Array.isArray(row.payload.files)) continue
    for (const f of row.payload.files) {
      if (isRow(f) && typeof Blob !== 'undefined' && f.blob instanceof Blob) out.push(f)
    }
  }
  return out
}
