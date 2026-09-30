import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { defaultSettings } from '@/db/defaults'
import { BACKUP_CONTEXT } from '@/db/repos/backup'
import { FILES_EMBED_LIMIT_BYTES, parseBackup, serializeBackup } from '@/logic/backup'
import { buildRawDump } from './exportData'

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
  it('dumps every table except the snapshots, as an ordinary backup file', async () => {
    await db.settings.add(defaultSettings(1))
    await db.parkingLot.add({
      id: 'p1',
      text: 'Look up the C182 cloud models lecture',
      sessionId: null,
      status: 'open',
      taskId: null,
    })
    const { dump, rows } = await buildRawDump(NOW)
    // The safety copies stay on the device: a backup never carries them.
    expect(Object.keys(dump.tables)).toHaveLength(db.tables.length - 1)
    expect(dump.tables.snapshots).toBeUndefined()
    expect(dump).toMatchObject({
      app: 'forge',
      format: 1,
      kind: 'raw-dump',
      appVersion: expect.any(String),
    })
    expect(dump.tables.settings).toHaveLength(1)
    expect(dump.tables.parkingLot).toHaveLength(1)
    expect(rows).toBe(2)
    expect(dump.schemaVersion).toBe(db.verno)
    expect(dump.exportedAt).toBe('2026-09-29T13:30:00.000Z')
    expect(dump.notes).toEqual([])
  })

  it('is a file Settings → Data → Import accepts, and brings the data back', async () => {
    await db.settings.add(defaultSettings(1))
    await db.parkingLot.add({
      id: 'p1',
      text: 'Look up the C182 cloud models lecture',
      sessionId: null,
      status: 'open',
      taskId: null,
    })
    await db.snapshots.add({
      id: 's1',
      createdAt: 1,
      updatedAt: 1,
      day: '2026-09-29',
      reason: 'daily',
      schemaVersion: 2,
      sizeBytes: 2,
      data: '{}',
    })
    const { dump } = await buildRawDump(NOW)
    const parsed = parseBackup(serializeBackup(dump), BACKUP_CONTEXT)
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    expect(parsed.file.tables.parkingLot).toHaveLength(1)
    expect(parsed.warnings).toEqual([])
  })

  it('writes a trashed resource’s file as a marker, never as `{}`', async () => {
    await db.trash.add({
      id: 'trash-1',
      createdAt: 1,
      updatedAt: 1,
      entityTable: 'milestones',
      entityId: 'm1',
      title: 'C779 Web Development Foundations',
      expiresAt: 2,
      payload: {
        milestones: [{ id: 'm1' }],
        files: [
          {
            id: 'f1',
            name: 'guide.pdf',
            mime: 'application/pdf',
            size: 4,
            blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/pdf' }),
          },
        ],
      },
    })
    const { dump } = await buildRawDump(NOW)
    const json = serializeBackup(dump)
    expect(json).toContain('"__blob": true')
    expect(json).not.toContain('"blob": {}')
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
