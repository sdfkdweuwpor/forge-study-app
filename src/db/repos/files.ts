/**
 * Attached files (`files` table): a Blob with its name, type and size. PDFs kept as resources live here
 * (`repos/resources.ts` stores the file and the resource in one transaction), and so does an image cover
 * restored from a backup. The table is kept apart from the rows that point at it, so lists and snapshots
 * stay light and a Blob is only read when someone opens it.
 *
 * `listFileMeta` is the way to show a file (name, size) without carrying its bytes along.
 */
import { newId } from '@/lib/ids'
import { db } from '../db'
import type { ID, Millis, StoredFile } from '../types'

export interface StoreFileOptions {
  /** Injected clock for tests; defaults to `Date.now()`. */
  now?: Millis
  /** Use this id instead of a fresh one (an import, a test). */
  id?: ID
}

export interface FileInfo {
  /** The file's name as it was added ("C182 study guide.pdf"). */
  name: string
  /** Its media type. Defaults to the Blob's own type, else `application/octet-stream`. */
  mime?: string
}

/** A file without its bytes. */
export interface FileMeta {
  id: ID
  name: string
  mime: string
  size: number
  createdAt: Millis
}

/** Stores a Blob and returns the row. `size` is always the Blob's own size. */
export async function storeFile(
  blob: Blob,
  info: FileInfo,
  opts: StoreFileOptions = {},
): Promise<StoredFile> {
  const now = opts.now ?? Date.now()
  const file: StoredFile = {
    id: opts.id ?? newId(),
    createdAt: now,
    updatedAt: now,
    name: info.name,
    mime: info.mime ?? (blob.type || 'application/octet-stream'),
    size: blob.size,
    blob,
  }
  await db.files.add(file)
  return file
}

/** The stored file, or `undefined` when there is none (deleted, or not in the backup it came from). */
export async function getFile(id: ID): Promise<StoredFile | undefined> {
  return db.files.get(id)
}

/** Name, type and size of the files that exist among `ids`, in no particular order. Bytes are not returned. */
export async function listFileMeta(ids: readonly ID[]): Promise<FileMeta[]> {
  if (ids.length === 0) return []
  const rows = await db.files
    .where(':id')
    .anyOf([...ids])
    .toArray()
  return rows.map(({ id, name, mime, size, createdAt }) => ({ id, name, mime, size, createdAt }))
}

/** Deletes a file for good. Returns false when there was none. Callers that need Undo trash the resource instead. */
export async function deleteFile(id: ID): Promise<boolean> {
  return db.transaction('rw', db.files, async () => {
    if ((await db.files.get(id)) === undefined) return false
    await db.files.delete(id)
    return true
  })
}
