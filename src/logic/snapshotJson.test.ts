import { describe, expect, it } from 'vitest'
import { buildBackup } from './backup'
import {
  filesInTrash,
  markTrashBlobs,
  serializeInChunks,
  withoutMarkedTrashFiles,
} from './snapshotJson'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()

describe('serializeInChunks', () => {
  it('writes exactly what JSON.stringify writes, and yields once per table', async () => {
    const file = await buildBackup({
      tables: {
        settings: [{ id: 'app', profile: { name: 'Ada' } }],
        tasks: [
          { id: 't1', title: 'C182 · Unit 3: Networking (45 min)', tags: ['C182'] },
          { id: 't2', title: 'Email mentor about "term plan"', tags: [] },
        ],
        goals: [],
      },
      schemaVersion: 2,
      appVersion: '0.1.0',
      now: NOW,
      embedFiles: false,
    })
    let yields = 0
    const text = await serializeInChunks(file, async () => void (yields += 1))
    expect(text).toBe(JSON.stringify(file))
    expect(yields).toBe(3)
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(file)))
  })

  it('falls back to a single stringify when the file has another layout', async () => {
    const odd = { tables: { tasks: [{ id: 't1' }] }, app: 'forge' } as unknown as Parameters<
      typeof serializeInChunks
    >[0]
    expect(await serializeInChunks(odd, async () => undefined)).toBe(JSON.stringify(odd))
  })
})

describe('trash blobs', () => {
  const pdf = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/pdf' })
  const trashRow = {
    id: 'trash-1',
    entityTable: 'milestones',
    payload: {
      milestones: [{ id: 'm1' }],
      files: [{ id: 'f1', name: 'C779 study guide.pdf', blob: pdf }],
    },
  }

  it('replaces a payload file’s Blob with a marker, leaving other rows alone', () => {
    const plain = { id: 'trash-2', payload: { tasks: [{ id: 't1' }] } }
    const [marked, untouched] = markTrashBlobs([trashRow, plain]) as [typeof trashRow, typeof plain]
    expect(marked.payload.files[0]?.blob).toEqual({
      __blob: true,
      type: 'application/pdf',
      size: 4,
    })
    expect(untouched).toBe(plain)
    // The source row still holds the real Blob.
    expect(trashRow.payload.files[0]?.blob).toBe(pdf)
    expect(JSON.stringify(marked)).not.toContain('{}')
  })

  it('drops payload files that are only markers (or an old `{}`) and keeps real ones', () => {
    const marked = markTrashBlobs([trashRow])[0]
    const [kept] = withoutMarkedTrashFiles([trashRow]) as [typeof trashRow]
    expect(kept.payload.files).toHaveLength(1)
    const [dropped] = withoutMarkedTrashFiles([marked]) as [typeof trashRow]
    expect(dropped.payload.files).toEqual([])
    expect(dropped.payload.milestones).toEqual([{ id: 'm1' }])
    const legacy = { ...trashRow, payload: { files: [{ id: 'f2', blob: {} }] } }
    expect((withoutMarkedTrashFiles([legacy])[0] as typeof legacy).payload.files).toEqual([])
  })
})

describe('filesInTrash', () => {
  const pdf = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/pdf' })

  it('lists the payload files that hold real bytes, and none that are markers or `{}`', () => {
    const rows = [
      {
        id: 't1',
        payload: {
          files: [
            { id: 'f1', blob: pdf },
            { id: 'f2', blob: {} },
          ],
        },
      },
      { id: 't2', payload: { tasks: [{ id: 'x' }] } },
      {
        id: 't3',
        payload: {
          files: [{ id: 'f3', blob: { __blob: true, type: 'application/pdf', size: 4 } }],
        },
      },
      'not a row',
      { id: 't4', payload: { files: [{ id: 'f4', blob: pdf }] } },
    ]
    expect(filesInTrash(rows).map((f) => f.id)).toEqual(['f1', 'f4'])
    expect(filesInTrash([])).toEqual([])
  })
})
