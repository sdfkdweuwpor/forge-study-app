import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { defaultSettings } from '@/db/defaults'
import { buildRawDump, FILES_EMBED_LIMIT_BYTES } from './exportData'

const NOW = Date.UTC(2026, 8, 29, 13, 30)

async function addFile(name: string, bytes: number[], mime = 'application/pdf'): Promise<void> {
  await db.files.add({
    id: name,
    name,
    mime,
    size: bytes.length,
    blob: new Blob([new Uint8Array(bytes)], { type: mime }),
  })
}

interface DumpedFile {
  name: string
  blob: { __blob: boolean; type: string; size: number; base64?: string }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('buildRawDump', () => {
  it('dumps every table with a row count and the schema version', async () => {
    await db.settings.add(defaultSettings(1))
    await db.parkingLot.add({
      id: 'p1',
      text: 'Look up the C182 cloud models lecture',
      sessionId: null,
      status: 'open',
      taskId: null,
    })
    const { dump, rows } = await buildRawDump(NOW)
    expect(Object.keys(dump.tables)).toHaveLength(db.tables.length)
    expect(dump.tables.settings).toHaveLength(1)
    expect(dump.tables.parkingLot).toHaveLength(1)
    expect(rows).toBe(2)
    expect(dump.schemaVersion).toBe(db.verno)
    expect(dump.exportedAt).toBe('2026-09-29T13:30:00.000Z')
    expect(dump.notes).toEqual([])
  })

  it('embeds small files as base64', async () => {
    await addFile('c182-study-guide.pdf', [0x25, 0x50, 0x44, 0x46]) // "%PDF"
    const { dump } = await buildRawDump(NOW)
    const [file] = dump.tables.files as DumpedFile[]
    expect(file?.blob).toMatchObject({ __blob: true, type: 'application/pdf', size: 4 })
    expect(file?.blob.base64).toBe(btoa('%PDF'))
    expect(dump.notes).toEqual([])
  })

  it('leaves file contents out, with a note, once they reach the size limit', async () => {
    await addFile('d278-notes.pdf', [1, 2, 3, 4, 5, 6])
    await addFile('c779-slides.pdf', [7, 8, 9, 10])
    const { dump } = await buildRawDump(NOW, 10) // 10 bytes total: not below the limit
    const files = dump.tables.files as DumpedFile[]
    expect(files).toHaveLength(2)
    for (const f of files) {
      expect(f.blob.__blob).toBe(true)
      expect(f.blob.base64).toBeUndefined()
    }
    expect(dump.notes).toHaveLength(1)
    expect(dump.notes[0]).toContain('without their contents')
  })

  it('uses 50 MB as the default limit', () => {
    expect(FILES_EMBED_LIMIT_BYTES).toBe(50 * 1024 * 1024)
  })
})
