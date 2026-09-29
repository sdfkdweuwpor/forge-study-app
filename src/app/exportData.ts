import { db } from '@/db/db'
import type { StoredFile } from '@/db/types'
import { dayOf } from '@/logic/dates'

export interface ExportResult {
  filename: string
  tables: number
  rows: number
}

/** Attached PDFs go into the dump (base64) only while they total less than this; a bigger library is left out. */
export const FILES_EMBED_LIMIT_BYTES = 50 * 1024 * 1024

/** What a stored file looks like in the JSON: the row without its Blob, plus the bytes when they fit. */
interface DumpedBlob {
  __blob: true
  type: string
  size: number
  /** Present only when the files were embedded. */
  base64?: string
}

export interface RawDump {
  app: 'forge'
  kind: 'raw-dump'
  exportedAt: string
  schemaVersion: number
  /** Things a reader should know the dump does not contain. */
  notes: string[]
  tables: Record<string, unknown[]>
}

/** Blobs cannot be JSON-encoded; keep a marker so the dump stays honest about what it omits. */
function replacer(_key: string, value: unknown): unknown {
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return { __blob: true, type: value.type, size: value.size }
  }
  return value
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

async function dumpBlob(blob: Blob, embed: boolean): Promise<DumpedBlob> {
  const marker: DumpedBlob = { __blob: true, type: blob.type, size: blob.size }
  if (!embed) return marker
  return { ...marker, base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) }
}

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Reads every table in ONE read transaction, so the dump is a consistent snapshot even while the app
 * keeps writing. Blob handles are collected inside the transaction, their bytes are read after it.
 */
export async function buildRawDump(
  now: number,
  embedLimitBytes: number = FILES_EMBED_LIMIT_BYTES,
): Promise<{ dump: RawDump; rows: number }> {
  const tables: Record<string, unknown[]> = {}
  await db.transaction('r', db.tables, async () => {
    for (const table of db.tables) tables[table.name] = await table.toArray()
  })

  const notes: string[] = []
  const files = (tables.files ?? []) as StoredFile[]
  if (files.length > 0) {
    const total = files.reduce((sum, f) => sum + f.blob.size, 0)
    const embed = total < embedLimitBytes
    if (!embed) {
      notes.push(
        `Attached files (${files.length}, ${mib(total)}) are listed without their contents because they exceed the ${mib(embedLimitBytes)} limit for this raw export. Use the full backup in Settings, or open each file in Forge.`,
      )
    }
    tables.files = await Promise.all(
      files.map(async (f) => ({ ...f, blob: await dumpBlob(f.blob, embed) })),
    )
  }

  const rows = Object.values(tables).reduce((n, list) => n + list.length, 0)
  return {
    rows,
    dump: {
      app: 'forge',
      kind: 'raw-dump',
      exportedAt: new Date(now).toISOString(),
      schemaVersion: db.verno,
      notes,
      tables,
    },
  }
}

/**
 * Raw dump of every Dexie table to a JSON download. Used by the error screens, so it depends on nothing
 * but the database and works even when the rest of the app is broken. (The validated backup lives in Settings, Phase 10.)
 */
export async function exportAllData(): Promise<ExportResult> {
  const now = Date.now()
  const { dump, rows } = await buildRawDump(now)
  const json = JSON.stringify(dump, replacer, 2)
  const filename = `forge-export-${dayOf(now)}.json`
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { filename, tables: Object.keys(dump.tables).length, rows }
}
