import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { getFile, listFileMeta, storeFile } from '@/db/repos/files'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()

const pdf = (text = '%PDF-1.7\nC182 study guide') => new Blob([text], { type: 'application/pdf' })

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('storeFile', () => {
  it('stores the Blob with its name, type and size, and reads the same bytes back', async () => {
    const blob = pdf()
    const stored = await storeFile(blob, { name: 'C182 study guide.pdf' }, { now: NOW })

    expect(stored).toMatchObject({
      name: 'C182 study guide.pdf',
      mime: 'application/pdf',
      size: blob.size,
      createdAt: NOW,
      updatedAt: NOW,
    })
    const read = await getFile(stored.id)
    expect(read).toMatchObject({ id: stored.id, name: 'C182 study guide.pdf', size: blob.size })
    expect(await read?.blob.text()).toBe('%PDF-1.7\nC182 study guide')
  })

  it('takes the type from the call, else the Blob, else octet-stream', async () => {
    const a = await storeFile(pdf(), { name: 'a.bin', mime: 'application/x-custom' })
    const b = await storeFile(pdf(), { name: 'b.pdf' })
    const c = await storeFile(new Blob(['x']), { name: 'c' })
    expect(a.mime).toBe('application/x-custom')
    expect(b.mime).toBe('application/pdf')
    expect(c.mime).toBe('application/octet-stream')
  })

  it('reports the size of the Blob whatever the caller thinks', async () => {
    const stored = await storeFile(new Blob(['12345']), { name: 'five.bin' })
    expect(stored.size).toBe(5)
  })

  it('uses the id it is given (an import) and refuses a duplicate', async () => {
    await storeFile(pdf(), { name: 'a.pdf' }, { id: 'file-1' })
    expect(await db.files.get('file-1')).toBeDefined()
    await expect(storeFile(pdf(), { name: 'b.pdf' }, { id: 'file-1' })).rejects.toThrow()
    expect(await db.files.count()).toBe(1)
  })
})

describe('getFile and listFileMeta', () => {
  it('returns undefined for a file that is not there', async () => {
    expect(await getFile('nope')).toBeUndefined()
  })

  it('lists name, type and size for the files that exist, without their bytes', async () => {
    const a = await storeFile(pdf('%PDF-1.7 a'), { name: 'a.pdf' }, { now: NOW })
    const b = await storeFile(pdf('%PDF-1.7 longer b'), { name: 'b.pdf' }, { now: NOW + 1 })
    await storeFile(pdf(), { name: 'not asked for.pdf' })

    const meta = await listFileMeta([a.id, b.id, 'missing'])
    expect(meta.map((m) => m.name).sort()).toEqual(['a.pdf', 'b.pdf'])
    for (const m of meta) {
      expect(Object.keys(m).sort()).toEqual(['createdAt', 'id', 'mime', 'name', 'size'])
    }
    expect(meta.find((m) => m.id === b.id)?.size).toBe(pdf('%PDF-1.7 longer b').size)
    expect(await listFileMeta([])).toEqual([])
  })
})
