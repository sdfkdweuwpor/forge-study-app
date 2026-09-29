import { db } from '@/db/db'
import { dayOf } from '@/logic/dates'

export interface ExportResult {
  filename: string
  tables: number
  rows: number
}

/** Blobs cannot be JSON-encoded; keep a marker so the dump stays honest about what it omits. */
function replacer(_key: string, value: unknown): unknown {
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return { __blob: true, type: value.type, size: value.size }
  }
  return value
}

/**
 * Raw dump of every Dexie table to a JSON download. Used by the error screens, so it depends on nothing
 * but the database and works even when the rest of the app is broken. (The validated backup lives in Settings, Phase 10.)
 */
export async function exportAllData(): Promise<ExportResult> {
  const tables: Record<string, unknown[]> = {}
  let rows = 0
  for (const table of db.tables) {
    const all = await table.toArray()
    tables[table.name] = all
    rows += all.length
  }
  const now = Date.now()
  const json = JSON.stringify(
    {
      app: 'forge',
      kind: 'raw-dump',
      exportedAt: new Date(now).toISOString(),
      schemaVersion: db.verno,
      tables,
    },
    replacer,
    2,
  )
  const filename = `forge-export-${dayOf(now)}.json`
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { filename, tables: Object.keys(tables).length, rows }
}
