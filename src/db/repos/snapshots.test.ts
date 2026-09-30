import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applySeed } from '@/dev/seed'
import { db } from '@/db/db'
import { BACKUP_CONTEXT, createSafetyCopy, readBackupTables } from '@/db/repos/backup'
import {
  SnapshotError,
  latestAutomaticDay,
  listSnapshots,
  pruneSnapshots,
  readSnapshotText,
  restoreSnapshot,
  runDailySnapshot,
  takeSnapshot,
} from '@/db/repos/snapshots'
import { createPdfResource, deleteResource } from '@/db/repos/resources'
import { createTask } from '@/db/repos/tasks'
import { updateSettings } from '@/db/repos/settings'
import { moveToTrash, restoreTrashItem } from '@/db/repos/trash'
import type { BackupFile } from '@/logic/backup'
import { parseBackup } from '@/logic/backup'
import type { Snapshot } from '@/db/types'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const DAY = 24 * 60 * 60 * 1000
const VERSION = '0.1.0'

/** The tables a restore replaces, as plain data (attached files are never replaced, so they are left out). */
async function replacedTables(): Promise<Record<string, unknown[]>> {
  const tables = await readBackupTables()
  delete tables.files
  return tables
}

const pdfBytes = new TextEncoder().encode('%PDF-1.7 C779 web development study guide')

async function addPdf(id = 'file-1'): Promise<void> {
  await db.files.add({
    id,
    createdAt: 111,
    updatedAt: 222,
    name: 'C779 study guide.pdf',
    mime: 'application/pdf',
    size: pdfBytes.length,
    blob: new Blob([pdfBytes], { type: 'application/pdf' }),
  })
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('takeSnapshot', () => {
  it('writes a compressed backup file without file bytes or snapshots, and lists it', async () => {
    await applySeed('wgu')
    await addPdf()
    const info = await takeSnapshot('manual', { now: NOW, appVersion: VERSION })

    expect(info).toMatchObject({
      reason: 'manual',
      day: '2026-09-29',
      createdAt: NOW,
      schemaVersion: 3,
    })
    expect(info?.counts?.tasks).toBeGreaterThan(20)
    expect(info?.counts?.files).toBe(1)
    const row = (await db.snapshots.toArray())[0] as Snapshot
    expect(row.data).toBe('')
    expect(row.gz).toBeInstanceOf(Blob)
    expect(row.gz!.size).toBeLessThan(row.sizeBytes / 3)

    const text = await readSnapshotText(row.id)
    expect(new Blob([text]).size).toBe(row.sizeBytes)
    const parsed = parseBackup(text, BACKUP_CONTEXT)
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    expect(parsed.file.tables.tasks?.length).toBe(info?.counts?.tasks)
    expect(parsed.file.tables.snapshots).toBeUndefined()
    expect(text).not.toContain('base64')
    expect(parsed.file.notes.join(' ')).toContain('without their contents')

    const listed = await listSnapshots()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toEqual(info)
    expect('data' in (listed[0] ?? {})).toBe(false)
  })

  it('stores plain text where the browser cannot compress', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    await applySeed('wgu')
    const info = await takeSnapshot('manual', { now: NOW, appVersion: VERSION })
    const row = (await db.snapshots.toArray())[0] as Snapshot
    expect(row.gz).toBeUndefined()
    expect(row.sizeBytes).toBe(new Blob([row.data]).size)
    expect(await readSnapshotText(info!.id)).toBe(row.data)
    expect(row.data.length).toBeGreaterThan(1000)
  })

  it('writes nothing when asked to skip an empty app, and something once there is data', async () => {
    await db.settings.clear()
    expect(
      await takeSnapshot('daily', { now: NOW, appVersion: VERSION, skipIfEmpty: true }),
    ).toBeNull()
    expect(await db.snapshots.count()).toBe(0)
    await createTask({ title: 'Renew library card' }, { now: NOW })
    expect(
      await takeSnapshot('daily', { now: NOW, appVersion: VERSION, skipIfEmpty: true }),
    ).not.toBeNull()
  })

  it('keeps the 5 newest manual snapshots', async () => {
    await applySeed('wgu')
    for (let i = 0; i < 7; i += 1) {
      await takeSnapshot('manual', { now: NOW + i * 60_000, appVersion: VERSION })
    }
    const kept = await listSnapshots()
    expect(kept).toHaveLength(5)
    expect(kept.map((s) => s.createdAt)).toEqual([6, 5, 4, 3, 2].map((i) => NOW + i * 60_000))
  })
})

describe('runDailySnapshot', () => {
  const run = (day: number) => {
    const now = NOW + day * DAY
    return runDailySnapshot({
      now,
      today: new Date(now).toLocaleDateString('en-CA'),
      appVersion: VERSION,
    })
  }

  it('writes one automatic snapshot per day, and only when there is data', async () => {
    await db.settings.clear()
    expect(await run(0)).toBeNull()

    await applySeed('wgu')
    expect(await latestAutomaticDay()).toBeNull()
    expect(await run(0)).toMatchObject({ reason: 'daily', day: '2026-09-29' })
    expect(await latestAutomaticDay()).toBe('2026-09-29')
    // Later the same day, and a second tab: nothing more.
    expect(await run(0)).toBeNull()
    expect(await db.snapshots.count()).toBe(1)
    // The next day: another.
    expect(await run(1)).toMatchObject({ day: '2026-09-30' })
    expect(await db.snapshots.count()).toBe(2)
  })

  it('does not write two when two starts race', async () => {
    await applySeed('wgu')
    const results = await Promise.all([run(0), run(0)])
    expect(results.filter((r) => r !== null)).toHaveLength(1)
    expect(await db.snapshots.count()).toBe(1)
  })

  it('does nothing when the clock moved back behind the last snapshot', async () => {
    await applySeed('wgu')
    await run(3)
    expect(await run(0)).toBeNull()
  })

  it('keeps the last 7 automatic snapshots, and manual ones separately', async () => {
    await applySeed('wgu')
    await takeSnapshot('manual', { now: NOW, appVersion: VERSION })
    for (let d = 0; d < 10; d += 1) await run(d)
    const all = await listSnapshots()
    expect(all.filter((s) => s.reason === 'daily')).toHaveLength(7)
    expect(all.filter((s) => s.reason === 'manual')).toHaveLength(1)
    expect(all.filter((s) => s.reason === 'daily').map((s) => s.day)).toEqual([
      '2026-10-08',
      '2026-10-07',
      '2026-10-06',
      '2026-10-05',
      '2026-10-04',
      '2026-10-03',
      '2026-10-02',
    ])
  })
})

describe('pruneSnapshots', () => {
  it('also trims the safety copies import and reset write, which never prune themselves', async () => {
    await applySeed('wgu')
    for (let i = 0; i < 7; i += 1) await createSafetyCopy('pre-import', NOW + i, VERSION)
    for (let i = 0; i < 2; i += 1) await createSafetyCopy('pre-reset', NOW + i, VERSION)
    expect(await pruneSnapshots()).toBe(2)
    const rows = await listSnapshots()
    expect(rows.filter((r) => r.reason === 'pre-import')).toHaveLength(5)
    expect(rows.filter((r) => r.reason === 'pre-reset')).toHaveLength(2)
    expect(await pruneSnapshots()).toBe(0)
  })
})

describe('restoreSnapshot', () => {
  it('round-trips: change everything, restore, and the data is what it was', async () => {
    await applySeed('wgu')
    const before = await replacedTables()
    const snap = await takeSnapshot('manual', { now: NOW, appVersion: VERSION })

    // Change the data in every way that matters: delete, add, edit, wipe a whole table.
    const someTask = (await db.tasks.toArray())[0]!
    await db.tasks.delete(someTask.id)
    await createTask({ title: 'Something new after the snapshot' }, { now: NOW + 5000 })
    await db.tasks.toCollection().modify({ title: 'Edited' })
    await db.xpEvents.clear()
    await updateSettings({ dailyGoalPomodoros: 11 })
    expect(await replacedTables()).not.toEqual(before)

    const result = await restoreSnapshot(snap!.id, { now: NOW + 10_000, appVersion: VERSION })
    expect(result.items).toBe(
      Object.entries(before).reduce(
        (n, [name, rows]) => (name === 'settings' ? n : n + rows.length),
        0,
      ),
    )
    expect(await replacedTables()).toEqual(before)
    expect((await db.tasks.get(someTask.id))?.title).toBe(someTask.title)
  })

  it('takes a pre-restore snapshot first, and restoring that is the undo', async () => {
    await applySeed('wgu')
    const snap = await takeSnapshot('manual', { now: NOW, appVersion: VERSION })
    await createTask({ title: 'Added after the snapshot' }, { now: NOW + 5000 })
    await updateSettings({ dailyGoalPomodoros: 11 })
    const changed = await replacedTables()

    const result = await restoreSnapshot(snap!.id, { now: NOW + 10_000, appVersion: VERSION })
    const pre = (await listSnapshots()).find((s) => s.id === result.preRestoreId)
    expect(pre).toMatchObject({ reason: 'pre-restore', createdAt: NOW + 10_000 })
    expect((await db.tasks.toArray()).some((t) => t.title === 'Added after the snapshot')).toBe(
      false,
    )

    await restoreSnapshot(result.preRestoreId, { now: NOW + 20_000, appVersion: VERSION })
    expect(await replacedTables()).toEqual(changed)
  })

  it('leaves attached files alone: those still here stay, the ones added later stay too', async () => {
    await applySeed('wgu')
    await addPdf('file-1')
    const snap = await takeSnapshot('manual', { now: NOW, appVersion: VERSION })
    await addPdf('file-2')
    await restoreSnapshot(snap!.id, { now: NOW + 1000, appVersion: VERSION })
    const files = await db.files.toArray()
    expect(files.map((f) => f.id).sort()).toEqual(['file-1', 'file-2'])
    const bytes = new Uint8Array(await files.find((f) => f.id === 'file-1')!.blob.arrayBuffer())
    expect(Array.from(bytes)).toEqual(Array.from(pdfBytes))
  })

  /** A course with a PDF resource, then the course moved to the Trash: its file's bytes now live only in the trash row. */
  async function trashCourseWithPdf() {
    await applySeed('wgu')
    const goal = (await db.goals.toArray())[0]!
    const course = (await db.milestones.where('goalId').equals(goal.id).toArray())[0]!
    await addPdf('file-1')
    await db.resources.add({
      id: 'r1',
      goalId: goal.id,
      milestoneId: course.id,
      kind: 'pdf',
      title: 'Study guide',
      url: null,
      fileId: 'file-1',
      status: 'toRead',
      notes: '',
      order: 0,
    })
    const trashed = await moveToTrash('milestones', course.id, { now: NOW })
    expect(await db.files.count()).toBe(0)
    expect(trashed?.item.payload.files).toHaveLength(1)
    return { course, trashed: trashed! }
  }

  const bytesOf = async (id: string): Promise<number[]> =>
    Array.from(new Uint8Array(await (await db.files.get(id))!.blob.arrayBuffer()))

  it('keeps a trashed PDF’s bytes when the restore replaces the Trash, and the entry still restores with its file', async () => {
    const { course, trashed } = await trashCourseWithPdf()
    const snap = await takeSnapshot('manual', { now: NOW, appVersion: VERSION })
    // The snapshot's JSON never holds `{}` for the file, only a marker.
    expect(await readSnapshotText(snap!.id)).toContain('"__blob":true')

    await restoreSnapshot(snap!.id, { now: NOW + 1000, appVersion: VERSION })
    const back = await db.trash.get(trashed.trashId)
    expect(back?.title).toBe(trashed.item.title)
    expect(back?.payload.files ?? []).toEqual([])
    expect(back?.payload.resources).toHaveLength(1)
    // The bytes moved from the Trash row to `files`, where the resource's `fileId` finds them.
    expect(await bytesOf('file-1')).toEqual(Array.from(pdfBytes))

    const out = await restoreTrashItem(trashed.trashId)
    expect(out.ok).toBe(true)
    expect(await db.milestones.get(course.id)).toBeDefined()
    const resource = await db.resources.get('r1')
    expect(resource).toMatchObject({ fileId: 'file-1' })
    expect(await bytesOf(resource!.fileId!)).toEqual(Array.from(pdfBytes))
  })

  it('does not lose a trashed PDF when the snapshot has no such Trash entry, and Undo restore brings the entry back with its file', async () => {
    await applySeed('wgu')
    const early = await takeSnapshot('manual', { now: NOW, appVersion: VERSION })
    const goal = (await db.goals.toArray())[0]!
    const course = (await db.milestones.where('goalId').equals(goal.id).toArray())[0]!
    await addPdf('file-1')
    await db.resources.add({
      id: 'r1',
      goalId: goal.id,
      milestoneId: course.id,
      kind: 'pdf',
      title: 'Study guide',
      url: null,
      fileId: 'file-1',
      status: 'toRead',
      notes: '',
      order: 0,
    })
    const trashed = await moveToTrash('milestones', course.id, { now: NOW + 500 })

    // Restoring the earlier snapshot drops the Trash entry, but not the bytes.
    const result = await restoreSnapshot(early!.id, { now: NOW + 1000, appVersion: VERSION })
    expect(await db.trash.count()).toBe(0)
    expect(await bytesOf('file-1')).toEqual(Array.from(pdfBytes))

    // Undo restore: the entry is back (the pre-restore snapshot holds no bytes) and restores with its file.
    await restoreSnapshot(result.preRestoreId, { now: NOW + 2000, appVersion: VERSION })
    expect((await db.trash.get(trashed!.trashId))?.payload.files ?? []).toEqual([])
    expect((await restoreTrashItem(trashed!.trashId)).ok).toBe(true)
    expect(await bytesOf((await db.resources.get('r1'))!.fileId!)).toEqual(Array.from(pdfBytes))
  })

  it('a PDF deleted through the resources repo keeps its bytes across a restore, and comes back from the Trash page', async () => {
    await applySeed('wgu')
    const goal = (await db.goals.toArray())[0]!
    const course = (await db.milestones.where('goalId').equals(goal.id).toArray())[0]!
    const bytes = new TextEncoder().encode('%PDF-1.7 C779 study guide')
    const { resource, file } = await createPdfResource(
      course.id,
      { name: 'C779 study guide.pdf', title: 'Study guide', notes: '', blob: new Blob([bytes]) },
      { now: NOW },
    )
    const snap = await takeSnapshot('manual', { now: NOW, appVersion: VERSION })
    const deleted = await deleteResource(resource.id)
    expect(await db.files.get(file.id)).toBeUndefined()

    await restoreSnapshot(snap!.id, { now: NOW + 1000, appVersion: VERSION })
    // The snapshot holds the resource and no bytes; the bytes were rescued from the Trash row it replaced.
    expect(await db.resources.get(resource.id)).toMatchObject({ fileId: file.id })
    expect(await bytesOf(file.id)).toEqual(Array.from(bytes))
    expect(await db.trash.get(deleted!.trashId)).toBeUndefined()
  })

  it('restores a snapshot made where the browser could not compress', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    await applySeed('wgu')
    const before = await replacedTables()
    const snap = await takeSnapshot('manual', { now: NOW, appVersion: VERSION })
    await db.tasks.clear()
    await restoreSnapshot(snap!.id, { now: NOW + 1000, appVersion: VERSION })
    expect(await replacedTables()).toEqual(before)
  })

  it('restores the copy import and reset write (a plain-text row from before compression)', async () => {
    await applySeed('wgu')
    const before = await replacedTables()
    const copy = await createSafetyCopy('pre-reset', NOW, VERSION)
    await Promise.all(BACKUP_TABLES_TO_WIPE.map((t) => db.table(t).clear()))
    expect(await db.tasks.count()).toBe(0)
    await restoreSnapshot(copy.snapshotId, { now: NOW + 1000, appVersion: VERSION })
    expect(await replacedTables()).toEqual(before)
  })

  it('brings a version 1 snapshot up to date on the way in', async () => {
    await applySeed('wgu')
    const v1: BackupFile = {
      app: 'forge',
      format: 1,
      schemaVersion: 1,
      appVersion: '0.0.9',
      exportedAt: '2026-09-01T12:00:00.000Z',
      notes: [],
      tables: {
        settings: [{ id: 'app', createdAt: 1, updatedAt: 1 }],
        tasks: [
          {
            id: 'task-1',
            createdAt: 1,
            updatedAt: 1,
            title: 'Read chapter 3 of C182',
            status: 'todo',
            source: 'schedule',
            dueDate: '2026-09-30',
            dueTime: null,
            estimateMinutes: 45,
          },
        ],
      },
    }
    await db.snapshots.add({
      id: 'old-1',
      createdAt: 1,
      updatedAt: 1,
      day: '2026-09-01',
      reason: 'daily',
      schemaVersion: 1,
      sizeBytes: 100,
      data: JSON.stringify(v1),
    })
    const result = await restoreSnapshot('old-1', { now: NOW, appVersion: VERSION })
    expect(result.fromVersion).toBe(1)
    const task = await db.tasks.get('task-1')
    expect(task).toMatchObject({ title: 'Read chapter 3 of C182', doDate: expect.anything() })
    expect(await db.goals.count()).toBe(0)
  })

  describe('a snapshot that cannot be restored changes nothing', () => {
    async function expectUntouched(action: () => Promise<unknown>, code: SnapshotError['code']) {
      const before = await replacedTables()
      const snapshotsBefore = await db.snapshots.count()
      const error = await action().then(
        () => null,
        (e: unknown) => e,
      )
      expect(error).toBeInstanceOf(SnapshotError)
      expect((error as SnapshotError).code).toBe(code)
      expect(await replacedTables()).toEqual(before)
      // No pre-restore snapshot for a restore that never started.
      expect(await db.snapshots.count()).toBe(snapshotsBefore)
    }

    it('one that does not exist', async () => {
      await applySeed('wgu')
      await expectUntouched(
        () => restoreSnapshot('nope', { now: NOW, appVersion: VERSION }),
        'missing',
      )
    })

    it('one whose bytes are not readable', async () => {
      await applySeed('wgu')
      await db.snapshots.add({
        id: 'bad-gz',
        createdAt: 1,
        updatedAt: 1,
        day: '2026-09-01',
        reason: 'manual',
        schemaVersion: 2,
        sizeBytes: 10,
        data: '',
        gz: new Blob(['this is not gzip']),
      })
      await expectUntouched(
        () => restoreSnapshot('bad-gz', { now: NOW, appVersion: VERSION }),
        'unreadable',
      )
    })

    it('one that is not a Forge backup, or is from a newer version', async () => {
      await applySeed('wgu')
      const row = (data: string, id: string): Snapshot => ({
        id,
        createdAt: 1,
        updatedAt: 1,
        day: '2026-09-01',
        reason: 'manual',
        schemaVersion: 2,
        sizeBytes: data.length,
        data,
      })
      await db.snapshots.bulkAdd([
        row('{"hello":"world"}', 'not-forge'),
        row(
          JSON.stringify({
            app: 'forge',
            format: 1,
            schemaVersion: 99,
            exportedAt: '2026-09-01T12:00:00.000Z',
            tables: { tasks: [{ id: 'x' }] },
          }),
          'future',
        ),
      ])
      await expectUntouched(
        () => restoreSnapshot('not-forge', { now: NOW, appVersion: VERSION }),
        'invalid',
      )
      await expectUntouched(
        () => restoreSnapshot('future', { now: NOW, appVersion: VERSION }),
        'invalid',
      )
    })
  })
})

const BACKUP_TABLES_TO_WIPE = ['tasks', 'goals', 'milestones', 'units', 'xpEvents'] as const
