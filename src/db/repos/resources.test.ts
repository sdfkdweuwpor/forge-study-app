import { beforeEach, describe, expect, it } from 'vitest'
import { COURSE_IDS, WGU_GOAL_ID, buildWguBsCs } from '@/data/sample/wguBsCs'
import { db } from '@/db/db'
import {
  ResourceError,
  createLinkResource,
  createNoteResource,
  createPdfResource,
  deleteResource,
  getResource,
  listResources,
  reorderResources,
  setResourceStatus,
  updateResource,
} from '@/db/repos/resources'
import { listTrash, moveToTrash, restoreFromTrash, restoreTrashItem } from '@/db/repos/trash'
import { dayOf } from '@/logic/dates'
import { MAX_PDF_BYTES } from '@/logic/resources'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const C779 = COURSE_IDS.C779
const C182 = COURSE_IDS.C182

const pdf = (text = '%PDF-1.7\nC182 study guide') => new Blob([text], { type: 'application/pdf' })

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  const { goal, milestones } = buildWguBsCs(dayOf(NOW), NOW)
  await db.goals.add(goal)
  await db.milestones.bulkAdd(milestones)
})

async function expectRejected(promise: Promise<unknown>, reason: string): Promise<ResourceError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ResourceError)
  expect((error as ResourceError).reason).toBe(reason)
  return error as ResourceError
}

describe('createLinkResource', () => {
  it('adds a link to the course, to read, at the end of the list', async () => {
    const a = await createLinkResource(
      C779,
      { url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout', title: 'MDN: CSS grid' },
      { now: NOW },
    )
    const b = await createLinkResource(C779, { url: 'https://www.w3.org/WAI/fundamentals/' }, { now: NOW + 1 })

    expect(a).toMatchObject({
      goalId: WGU_GOAL_ID,
      milestoneId: C779,
      kind: 'link',
      title: 'MDN: CSS grid',
      url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout',
      fileId: null,
      status: 'toRead',
      notes: '',
      order: 0,
      createdAt: NOW,
    })
    expect(b.order).toBeGreaterThan(a.order)
    expect((await listResources(C779)).map((r) => r.id)).toEqual([a.id, b.id])
  })

  it('makes the title from the address when none is typed, and normalises the address', async () => {
    const r = await createLinkResource(C779, { url: '  www.wgu.edu/online-it-degrees/ ', title: '   ' })
    expect(r.url).toBe('https://www.wgu.edu/online-it-degrees/')
    expect(r.title).toBe('wgu.edu/online-it-degrees')
  })

  it('refuses anything that is not a web link, and writes nothing', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', '', 'nonsense']) {
      await expectRejected(createLinkResource(C779, { url }), 'url')
    }
    expect(await db.resources.count()).toBe(0)
  })

  it('refuses a course that is not there', async () => {
    await expectRejected(createLinkResource('nope', { url: 'https://example.com' }), 'course-missing')
  })

  it('keeps each course’s list apart', async () => {
    await createLinkResource(C779, { url: 'https://example.com/a' })
    const other = await createLinkResource(C182, { url: 'https://example.com/b' })
    expect(other.order).toBe(0)
    expect(await listResources(C182)).toHaveLength(1)
    expect(await listResources(C779)).toHaveLength(1)
  })
})

describe('createNoteResource', () => {
  it('adds a note with its title and body', async () => {
    const n = await createNoteResource(
      C779,
      { title: 'Exam tips', notes: 'Read the rubric first.\nBox model questions are worth the most.' },
      { now: NOW },
    )
    expect(n).toMatchObject({
      kind: 'note',
      title: 'Exam tips',
      url: null,
      fileId: null,
      status: 'toRead',
      notes: 'Read the rubric first.\nBox model questions are worth the most.',
    })
  })

  it('names an untitled note from its first line, and needs one or the other', async () => {
    const n = await createNoteResource(C779, { notes: '\nFlexbox vs grid\nGrid is two-dimensional' })
    expect(n.title).toBe('Flexbox vs grid')
    const titleOnly = await createNoteResource(C779, { title: 'Ask mentor about the PA', notes: '' })
    expect(titleOnly.notes).toBe('')
    await expectRejected(createNoteResource(C779, { title: '  ', notes: '  ' }), 'title')
    expect(await db.resources.count()).toBe(2)
  })
})

describe('createPdfResource', () => {
  it('stores the file and its resource together, keeping the bytes and the size', async () => {
    const blob = pdf('%PDF-1.7\nC182 study guide, unit 1')
    const { resource, file } = await createPdfResource(
      C182,
      { blob, name: 'C182_Study_Guide.pdf' },
      { now: NOW },
    )

    expect(resource).toMatchObject({
      goalId: WGU_GOAL_ID,
      milestoneId: C182,
      kind: 'pdf',
      title: 'C182 Study Guide',
      url: null,
      fileId: file.id,
      status: 'toRead',
    })
    expect(file).toMatchObject({ name: 'C182_Study_Guide.pdf', mime: 'application/pdf', size: blob.size })
    const stored = await db.files.get(file.id)
    expect(await stored?.blob.text()).toBe('%PDF-1.7\nC182 study guide, unit 1')
    expect(await db.resources.get(resource.id)).toEqual(resource)
  })

  it('stores the bytes as a PDF whatever the sender labelled them', async () => {
    const labelled = new Blob(['%PDF-1.4 x'], { type: '' })
    const { file } = await createPdfResource(C779, { blob: labelled, name: 'guide.pdf' })
    expect(file.mime).toBe('application/pdf')
    expect((await db.files.get(file.id))?.blob.type).toBe('application/pdf')
  })

  it('takes a typed title and a note', async () => {
    const { resource } = await createPdfResource(C779, {
      blob: pdf(),
      name: 'x.pdf',
      title: 'Practice exam A',
      notes: 'Take it timed.',
    })
    expect(resource).toMatchObject({ title: 'Practice exam A', notes: 'Take it timed.' })
  })

  it('refuses a file over 50 MB, and allows exactly 50 MB', async () => {
    const tooBig = new Blob([new Uint8Array(MAX_PDF_BYTES + 1)], { type: 'application/pdf' })
    const error = await expectRejected(createPdfResource(C779, { blob: tooBig, name: 'lecture.pdf' }), 'file')
    expect(error.message).toContain('50 MB')
    expect(await db.files.count()).toBe(0)
    expect(await db.resources.count()).toBe(0)

    const head = new TextEncoder().encode('%PDF-1.7\n')
    const bytes = new Uint8Array(MAX_PDF_BYTES)
    bytes.set(head)
    await createPdfResource(C779, { blob: new Blob([bytes], { type: 'application/pdf' }), name: 'exact.pdf' })
    expect((await db.files.toArray())[0]?.size).toBe(MAX_PDF_BYTES)
  })

  it('refuses a file that is not a PDF, by type, by bytes, or empty', async () => {
    await expectRejected(
      createPdfResource(C779, { blob: new Blob(['hello'], { type: 'text/plain' }), name: 'notes.txt' }),
      'file',
    )
    // Named and typed as a PDF, but the bytes are a web page: never stored, so it can never be opened as one.
    await expectRejected(
      createPdfResource(C779, {
        blob: new Blob(['<html><script>alert(1)</script></html>'], { type: 'application/pdf' }),
        name: 'trick.pdf',
      }),
      'file',
    )
    await expectRejected(
      createPdfResource(C779, { blob: new Blob([], { type: 'application/pdf' }), name: 'empty.pdf' }),
      'file',
    )
    expect(await db.files.count()).toBe(0)
    expect(await db.resources.count()).toBe(0)
  })

  it('leaves no file behind when the course is gone', async () => {
    await expectRejected(createPdfResource('nope', { blob: pdf(), name: 'a.pdf' }), 'course-missing')
    expect(await db.files.count()).toBe(0)
  })
})

describe('updateResource', () => {
  it('edits a title and a note', async () => {
    const r = await createNoteResource(C779, { title: 'Exam tips', notes: 'one' }, { now: NOW })
    const next = await updateResource(r.id, { title: 'Exam tips (C779)', notes: 'one\ntwo' }, { now: NOW + 5 })
    expect(next).toMatchObject({ title: 'Exam tips (C779)', notes: 'one\ntwo', updatedAt: NOW + 5 })
    expect(await getResource(r.id)).toEqual(next)
  })

  it('changes a link’s address, and its title follows only when it was made from the old address', async () => {
    const auto = await createLinkResource(C779, { url: 'https://example.com/old' })
    const custom = await createLinkResource(C779, { url: 'https://example.com/old', title: 'My name for it' })
    const a = await updateResource(auto.id, { url: 'https://example.com/new', title: auto.title })
    const b = await updateResource(custom.id, { url: 'https://example.com/new', title: custom.title })
    expect(a).toMatchObject({ url: 'https://example.com/new', title: 'example.com/new' })
    expect(b).toMatchObject({ url: 'https://example.com/new', title: 'My name for it' })
  })

  it('refuses a bad address and changes nothing', async () => {
    const r = await createLinkResource(C779, { url: 'https://example.com/a', title: 'A' })
    await expectRejected(updateResource(r.id, { url: 'javascript:alert(1)', title: 'B' }), 'url')
    expect(await getResource(r.id)).toEqual(r)
  })

  it('falls back to a made title when the title is cleared', async () => {
    const link = await createLinkResource(C779, { url: 'https://www.wgu.edu/x', title: 'WGU' })
    const note = await createNoteResource(C779, { title: 'T', notes: '\nFirst line\nsecond' })
    const { resource: file } = await createPdfResource(C779, { blob: pdf(), name: 'D278_Practice_Exam.pdf' })
    expect((await updateResource(link.id, { title: ' ' }))?.title).toBe('wgu.edu/x')
    expect((await updateResource(note.id, { title: '' }))?.title).toBe('First line')
    expect((await updateResource(file.id, { title: '' }))?.title).toBe('D278 Practice Exam')
  })

  it('ignores an address on a note or a PDF', async () => {
    const note = await createNoteResource(C779, { title: 'T', notes: 'n' })
    const next = await updateResource(note.id, { url: 'https://example.com' })
    expect(next?.url).toBeNull()
  })

  it('does not write, or stamp, when nothing changed', async () => {
    const r = await createNoteResource(C779, { title: 'Same', notes: 'same' }, { now: NOW })
    const next = await updateResource(r.id, { title: 'Same', notes: 'same' }, { now: NOW + 99 })
    expect(next?.updatedAt).toBe(NOW)
    expect((await getResource(r.id))?.updatedAt).toBe(NOW)
  })

  it('returns null for a resource that is gone', async () => {
    expect(await updateResource('nope', { title: 'x' })).toBeNull()
  })
})

describe('setResourceStatus', () => {
  it('toggles between to read and done', async () => {
    const r = await createLinkResource(C779, { url: 'https://example.com' }, { now: NOW })
    const done = await setResourceStatus(r.id, 'done', { now: NOW + 10 })
    expect(done).toMatchObject({ status: 'done', updatedAt: NOW + 10 })
    expect((await getResource(r.id))?.status).toBe('done')
    const back = await setResourceStatus(r.id, 'toRead', { now: NOW + 20 })
    expect(back?.status).toBe('toRead')
  })

  it('does nothing to a resource that already has the status, and returns null for a missing one', async () => {
    const r = await createLinkResource(C779, { url: 'https://example.com' }, { now: NOW })
    expect((await setResourceStatus(r.id, 'toRead', { now: NOW + 10 }))?.updatedAt).toBe(NOW)
    expect(await setResourceStatus('nope', 'done')).toBeNull()
  })
})

describe('reorderResources', () => {
  async function three() {
    const a = await createLinkResource(C779, { url: 'https://example.com/a', title: 'A' })
    const b = await createLinkResource(C779, { url: 'https://example.com/b', title: 'B' })
    const c = await createNoteResource(C779, { title: 'C', notes: '' })
    return [a, b, c] as const
  }
  const titles = async () => (await listResources(C779)).map((r) => r.title)

  it('applies a new order and writes only the rows that moved', async () => {
    const [a, b, c] = await three()
    expect(await reorderResources(C779, [c.id, a.id, b.id], { now: NOW + 5 })).toBe(3)
    expect(await titles()).toEqual(['C', 'A', 'B'])

    expect(await reorderResources(C779, [c.id, b.id, a.id])).toBe(2)
    expect(await titles()).toEqual(['C', 'B', 'A'])
    expect(await reorderResources(C779, [c.id, b.id, a.id])).toBe(0)
  })

  it('reorders a filtered subset in the positions those rows already hold', async () => {
    const [a, b, c] = await three()
    await setResourceStatus(b.id, 'done')
    // The To read tab shows A and C. Dragging C above A leaves the done B in the middle.
    await reorderResources(C779, [c.id, a.id])
    expect(await titles()).toEqual(['C', 'B', 'A'])
  })

  it('does not touch another course’s order', async () => {
    const [a, b] = await three()
    const other = await createLinkResource(C182, { url: 'https://example.com/o' })
    await reorderResources(C779, [b.id, a.id, other.id])
    expect((await getResource(other.id))?.order).toBe(0)
  })
})

describe('deleteResource', () => {
  it('moves a link to the Trash and Undo puts the same row back', async () => {
    const r = await createLinkResource(
      C779,
      { url: 'https://developer.mozilla.org/docs/Web/CSS/CSS_grid_layout', title: 'MDN grid guide' },
      { now: NOW },
    )
    await setResourceStatus(r.id, 'done', { now: NOW + 1 })
    const before = await getResource(r.id)

    const deleted = await deleteResource(r.id)
    expect(deleted).not.toBeNull()
    expect(await db.resources.count()).toBe(0)
    const [entry] = await db.trash.toArray()
    expect(entry).toMatchObject({ entityTable: 'resources', entityId: r.id, title: 'MDN grid guide' })
    expect(entry?.id).toBe(deleted?.trashId)

    await deleted?.undo()
    expect(await getResource(r.id)).toEqual(before)
    expect(await db.trash.count()).toBe(0)
  })

  it('takes a PDF’s file with it, and Undo brings the file back with its bytes', async () => {
    const { resource, file } = await createPdfResource(C182, {
      blob: pdf('%PDF-1.7\nSecurity and ethics'),
      name: 'C182 security.pdf',
    })
    const deleted = await deleteResource(resource.id)
    expect(await db.resources.count()).toBe(0)
    expect(await db.files.count()).toBe(0)
    const [entry] = await db.trash.toArray()
    expect(Object.keys(entry?.payload ?? {}).sort()).toEqual(['files', 'resources'])

    await deleted?.undo()
    expect(await db.resources.get(resource.id)).toEqual(resource)
    const back = await db.files.get(file.id)
    expect(back).toMatchObject({ name: 'C182 security.pdf', mime: 'application/pdf', size: file.size })
    expect(await back?.blob.text()).toBe('%PDF-1.7\nSecurity and ethics')
    expect(await db.trash.count()).toBe(0)
  })

  it('returns null for a resource that is already gone, and Undo twice is harmless', async () => {
    expect(await deleteResource('nope')).toBeNull()
    const r = await createLinkResource(C779, { url: 'https://example.com' })
    const deleted = await deleteResource(r.id)
    await deleted?.undo()
    await deleted?.undo()
    expect(await db.resources.count()).toBe(1)
  })

  it('will not restore into a course that has since gone to the Trash', async () => {
    const r = await createLinkResource(C779, { url: 'https://example.com', title: 'Stray' })
    const deleted = await deleteResource(r.id)
    await moveToTrash('milestones', C779)
    await expect(deleted?.undo()).rejects.toBeInstanceOf(ResourceError)
    expect(await db.resources.count()).toBe(0)
    expect(await db.trash.count()).toBe(2)
  })
})

describe('trashing a course or goal takes its resources and files, and restoring brings them back', () => {
  async function library() {
    const link = await createLinkResource(C182, { url: 'https://example.com/a', title: 'Link' })
    const note = await createNoteResource(C182, { title: 'Note', notes: 'body' })
    const { resource: pdfRow, file } = await createPdfResource(C182, {
      blob: pdf('%PDF-1.7\ncourse pdf'),
      name: 'guide.pdf',
    })
    const other = await createLinkResource(C779, { url: 'https://example.com/other', title: 'Other course' })
    const { file: otherFile } = await createPdfResource(C779, { blob: pdf(), name: 'other.pdf' })
    return { link, note, pdfRow, file, other, otherFile }
  }

  it('a course: its resources and their files go in one entry; other courses are untouched', async () => {
    const { link, note, pdfRow, file, other, otherFile } = await library()
    const trashed = await moveToTrash('milestones', C182)

    expect(await db.trash.count()).toBe(1)
    expect((await db.resources.toArray()).map((r) => r.id).sort()).toEqual(
      [other.id, (await listResources(C779)).find((r) => r.kind === 'pdf')?.id ?? ''].sort(),
    )
    expect(await db.files.get(file.id)).toBeUndefined()
    expect(await db.files.get(otherFile.id)).toBeDefined()
    expect(Object.keys(trashed?.item.payload ?? {})).toEqual(
      expect.arrayContaining(['milestones', 'resources', 'files']),
    )

    await trashed?.undo()
    expect((await listResources(C182)).map((r) => r.id).sort()).toEqual([link.id, note.id, pdfRow.id].sort())
    const back = await db.files.get(file.id)
    expect(await back?.blob.text()).toBe('%PDF-1.7\ncourse pdf')
  })

  it('a goal: every course’s resources and files', async () => {
    await library()
    const trashed = await moveToTrash('goals', WGU_GOAL_ID)
    expect(await db.resources.count()).toBe(0)
    expect(await db.files.count()).toBe(0)
    expect(await db.trash.count()).toBe(1)

    await restoreFromTrash(trashed?.trashId ?? '')
    expect(await db.resources.count()).toBe(5)
    expect(await db.files.count()).toBe(2)
  })
})

describe('a resource deleted before its course', () => {
  async function setup() {
    const { resource, file } = await createPdfResource(C779, { blob: pdf(), name: 'a.pdf', title: 'Loose PDF' })
    await deleteResource(resource.id)
    await moveToTrash('milestones', C779)
    const entries = await listTrash()
    const own = entries.find((e) => e.table === 'resources')
    const course = entries.find((e) => e.table === 'milestones')
    return { resource, file, own, course }
  }

  it('shows its course in the Trash, and restoring it brings the course back first', async () => {
    const { resource, file, own, course } = await setup()
    expect(own?.parents.map((p) => [p.table, p.state])).toEqual(
      expect.arrayContaining([['milestones', 'trashed']]),
    )

    const restored = await restoreTrashItem(own?.id ?? '')
    expect(restored.ok).toBe(true)
    if (restored.ok) expect(restored.alsoRestored.map((i) => i.id)).toEqual([course?.id])
    expect(await db.milestones.get(C779)).toBeDefined()
    expect(await db.resources.get(resource.id)).toBeDefined()
    expect(await db.files.get(file.id)).toBeDefined()
  })

  it('cannot come back on its own once the course is gone for good', async () => {
    const { own, course } = await setup()
    await db.trash.delete(course?.id ?? '')
    const after = (await listTrash()).find((e) => e.id === own?.id)
    expect(after?.restorable).toBe(false)

    const result = await restoreTrashItem(own?.id ?? '')
    expect(result).toMatchObject({ ok: false, reason: 'parent-gone' })
    expect(await db.resources.count()).toBe(0)
    expect(await db.files.count()).toBe(0)
  })
})
