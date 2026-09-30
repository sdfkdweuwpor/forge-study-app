import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applySeed } from '@/dev/seed'
import { ForgeDB, db } from '@/db/db'
import { defaultSyncState } from '@/db/defaults'
import { BACKUP_TABLES } from '@/db/repos/backup'
import {
  BACKUP_CONTEXT,
  createSafetyCopy,
  exportBackup,
  importBackup,
  isBackupReminderDue,
  markBackedUp,
  markReminded,
  readBackupTables,
  resetAllData,
} from '@/db/repos/backup'
import { getSettings, updateSettings } from '@/db/repos/settings'
import { readSnapshotText, takeSnapshot } from '@/db/repos/snapshots'
import type { BackupFile } from '@/logic/backup'
import { migrateBackupV1toV2, parseBackup } from '@/logic/backup'
import type { StoredFile, SyncStateRow } from '@/db/types'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const DAY = 24 * 60 * 60 * 1000
const VERSION = '0.1.0'

const pdfBytes = new TextEncoder().encode('%PDF-1.7 C779 web development study guide')

/** The database as it is, as data: attached files reduced to type and bytes so they compare. */
async function snapshotOfTables(): Promise<Record<string, unknown[]>> {
  const tables = await readBackupTables()
  tables.files = await Promise.all(
    (tables.files as StoredFile[]).map(async (f) => ({
      ...f,
      blob: { type: f.blob.type, bytes: Array.from(new Uint8Array(await f.blob.arrayBuffer())) },
    })),
  )
  return tables
}

async function seedEverything(): Promise<void> {
  await applySeed('wgu')
  await db.files.add({
    id: 'file-1',
    createdAt: 111,
    updatedAt: 222,
    name: 'C779 study guide.pdf',
    mime: 'application/pdf',
    size: pdfBytes.length,
    blob: new Blob([pdfBytes], { type: 'application/pdf' }),
  })
  await db.parkingLot.add({
    id: 'park-1',
    createdAt: 333,
    updatedAt: 333,
    text: 'Check the C182 forum',
    status: 'open',
    sessionId: null,
  } as never)
}

beforeEach(async () => {
  db.syncTracker.setEnabled(false)
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('export', () => {
  it('reads every backup table, stamps the versions and leaves snapshots out', async () => {
    await seedEverything()
    await db.snapshots.add({
      id: 'snap-1',
      createdAt: 1,
      updatedAt: 1,
      day: '2026-09-28',
      reason: 'daily',
      schemaVersion: 2,
      sizeBytes: 2,
      data: '{}',
    })
    const out = await exportBackup(NOW, VERSION)
    expect(out.filename).toBe('forge-backup-2026-09-29.json')
    expect(out.file).toMatchObject({
      app: 'forge',
      format: 1,
      schemaVersion: 3,
      appVersion: VERSION,
      exportedAt: new Date(NOW).toISOString(),
    })
    // Neither the snapshots nor this device's sync bookkeeping travel in a backup.
    expect(out.file.tables.syncOutbox).toBeUndefined()
    expect(out.file.tables.syncState).toBeUndefined()
    expect(Object.keys(out.file.tables).sort()).toEqual([...BACKUP_TABLES].sort())
    expect(out.file.tables.snapshots).toBeUndefined()
    expect(out.file.tables.tasks?.length).toBeGreaterThan(20)
    expect(out.items).toBeGreaterThan(50)
    // The attached PDF travels as base64.
    expect(JSON.parse(out.json).tables.files[0].blob.base64).toBeTypeOf('string')
  })

  it('records the time of a saved backup', async () => {
    await seedEverything()
    expect((await getSettings()).backup.lastExportAt).toBeNull()
    await markBackedUp(NOW)
    expect((await getSettings()).backup.lastExportAt).toBe(NOW)
  })
})

describe('export → reset → import', () => {
  it('gives back identical tables, attached file bytes included', async () => {
    await seedEverything()
    const before = await snapshotOfTables()
    expect(before.tasks?.length).toBeGreaterThan(20)
    expect(before.files).toHaveLength(1)

    const { json } = await exportBackup(NOW, VERSION)
    await resetAllData()
    const wiped = await readBackupTables()
    expect(wiped.tasks).toEqual([])
    expect(wiped.goals).toEqual([])
    expect(wiped.files).toEqual([])
    expect(wiped.xpEvents).toEqual([])

    const parsed = parseBackup(json, BACKUP_CONTEXT)
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    const result = await importBackup(parsed.file, NOW)
    expect(result.fromVersion).toBe(3)
    expect(result.skippedFiles).toBe(0)
    expect(result.items).toBeGreaterThan(50)

    const after = await snapshotOfTables()
    for (const name of BACKUP_TABLES) {
      expect(after[name], name).toEqual(before[name])
    }
    expect(after.files).toEqual(before.files)
  })

  it('replaces what is there, it does not merge', async () => {
    await seedEverything()
    const { file } = await exportBackup(NOW, VERSION)
    await db.tasks.add({ id: 'extra-task', title: 'Written after the backup' } as never)
    await importBackup(file, NOW)
    expect(await db.tasks.get('extra-task')).toBeUndefined()
  })

  it('takes the file through JSON text, so what is written is what is read', async () => {
    await seedEverything()
    const { file, json } = await exportBackup(NOW, VERSION)
    const parsed = parseBackup(json, BACKUP_CONTEXT)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.file).toEqual(JSON.parse(JSON.stringify(file)))
  })
})

describe('safety copy and snapshots', () => {
  it('writes a snapshot row without file bytes and returns a full copy to download', async () => {
    await seedEverything()
    const copy = await createSafetyCopy('pre-import', NOW, VERSION)
    const rows = await db.snapshots.toArray()
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row).toMatchObject({
      id: copy.snapshotId,
      reason: 'pre-import',
      day: '2026-09-29',
      schemaVersion: 3,
      createdAt: NOW,
    })
    expect(row?.sizeBytes).toBeGreaterThan(1000)
    const inside = JSON.parse(row?.data ?? '{}') as BackupFile
    expect(inside.app).toBe('forge')
    expect(inside.tables.tasks?.length).toBeGreaterThan(20)
    expect(inside.tables.snapshots).toBeUndefined()
    expect(JSON.stringify(inside.tables.files)).not.toContain('base64')

    expect(copy.download.filename).toBe('forge-before-import-2026-09-29.json')
    expect(JSON.parse(copy.download.json).tables.files[0].blob.base64).toBeTypeOf('string')
  })

  it('survives an import and a reset, which never clear it', async () => {
    await seedEverything()
    const copy = await createSafetyCopy('pre-reset', NOW, VERSION)
    const { file } = await exportBackup(NOW, VERSION)
    await importBackup(file, NOW)
    expect(await db.snapshots.get(copy.snapshotId)).toBeDefined()
    await resetAllData()
    expect(await db.snapshots.get(copy.snapshotId)).toBeDefined()
  })

  it('the snapshot alone brings the data back (it is a valid backup file)', async () => {
    await seedEverything()
    const before = await readBackupTables()
    const copy = await createSafetyCopy('pre-import', NOW, VERSION)
    await resetAllData()
    const row = await db.snapshots.get(copy.snapshotId)
    const parsed = parseBackup(row?.data ?? '', BACKUP_CONTEXT)
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    await importBackup(parsed.file, NOW)
    const after = await readBackupTables()
    expect(after.tasks).toEqual(before.tasks)
    expect(after.goals).toEqual(before.goals)
    // Attached files are the one thing a snapshot leaves out.
    expect(after.files).toEqual([])
  })
})

describe('a version 1 backup', () => {
  const v1File = (): BackupFile => ({
    app: 'forge',
    format: 1,
    schemaVersion: 1,
    appVersion: '0.0.9',
    exportedAt: '2026-09-01T12:00:00.000Z',
    notes: [],
    tables: {
      settings: [
        {
          id: 'app',
          createdAt: 1,
          updatedAt: 1,
          scheduling: { defaultStudyStart: '20:00' },
          appearance: { theme: 'dark', accent: 'teal', reducedMotion: 'system' },
        },
      ],
      goals: [
        {
          id: 'goal-1',
          createdAt: 1,
          updatedAt: 1,
          title: 'B.S. Computer Science — WGU',
          targetDate: '2027-03-31',
          availability: { minutesByWeekday: [0, 60, 60, 60, 60, 60, 0], daysOff: [] },
        },
      ],
      milestones: [
        {
          id: 'course-c182',
          createdAt: 1,
          updatedAt: 1,
          goalId: 'goal-1',
          code: 'C182',
          title: 'Introduction to IT',
          courseType: 'OA',
          status: 'active',
          order: 0,
        },
      ],
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
  })

  it('is upgraded on the way in, exactly as the Dexie upgrade would', async () => {
    const file = v1File()
    const result = await importBackup(file, NOW)
    expect(result.fromVersion).toBe(1)

    const expected = migrateBackupV1toV2(file, NOW).tables
    const task = await db.tasks.get('task-1')
    expect(task).toMatchObject({
      doDate: '2026-09-30',
      dueDate: null,
      durationMinutes: 45,
      kind: 'study',
    })
    expect(await db.tasks.toArray()).toEqual(expected.tasks)
    expect(await db.goals.toArray()).toEqual(expected.goals)
    // Planned assessments are made for WGU courses, with stable ids.
    expect((await db.plannedAssessments.toArray()).map((a) => a.id).sort()).toEqual(
      (expected.plannedAssessments as { id: string }[]).map((a) => a.id).sort(),
    )
    expect(await db.plannedAssessments.count()).toBeGreaterThan(0)
  })

  it('completes the settings row with keys the backup predates', async () => {
    await importBackup(v1File(), NOW)
    const settings = await getSettings()
    expect(settings.appearance.theme).toBe('dark')
    expect(settings.appearance.accent).toBe('teal')
    expect(settings.scheduling.defaultStudyStart).toBe('20:00')
    expect(settings.scheduling.taskWindows).toHaveLength(7)
    expect(settings.backup).toEqual({
      lastExportAt: null,
      remindWeekly: true,
      lastRemindedAt: null,
    })
    expect(await db.settings.get('app')).toMatchObject({ backup: { remindWeekly: true } })
  })

  it('creates the settings row when the backup has none', async () => {
    const file = v1File()
    delete file.tables.settings
    await importBackup(file, NOW)
    expect(await db.settings.count()).toBe(1)
    expect((await getSettings()).timer.pomodoroMin).toBe(25)
  })
})

describe('a failed import', () => {
  it('rolls back: nothing is cleared and nothing is half written', async () => {
    await seedEverything()
    const before = await snapshotOfTables()
    const { file } = await exportBackup(NOW, VERSION)
    // A row IndexedDB cannot store, in the LAST table written, after every other table was replaced.
    const broken: BackupFile = {
      ...file,
      tables: {
        ...file.tables,
        tasks: [{ id: 'imported-task', title: 'Would replace everything' }],
        readiness: [{ id: 'bad-row', explode: () => 1 }],
      },
    }
    await expect(importBackup(broken, NOW)).rejects.toThrow()

    const after = await snapshotOfTables()
    for (const name of BACKUP_TABLES) {
      expect(after[name], name).toEqual(before[name])
    }
    expect(await db.tasks.get('imported-task')).toBeUndefined()
  })
})

describe('reset', () => {
  it('empties every table, brings back a default settings row and keeps snapshots', async () => {
    await seedEverything()
    await updateSettings({ appearance: { accent: 'pink' }, profile: { name: 'Sam' } })
    await createSafetyCopy('pre-reset', NOW, VERSION)
    expect((await getSettings()).onboardedAt).not.toBeNull()

    await resetAllData()

    const tables = await readBackupTables()
    for (const name of BACKUP_TABLES) {
      if (name === 'settings') continue
      expect(tables[name], name).toEqual([])
    }
    expect(tables.settings).toHaveLength(1)
    const settings = await getSettings()
    expect(settings.onboardedAt).toBeNull()
    expect(settings.appearance.accent).toBe('blue')
    expect(settings.profile.name).toBe('')
    expect(await db.snapshots.count()).toBe(1)
  })
})

describe('cloud sync bookkeeping (PLAN §4.7.4)', () => {
  const TOKEN = 'access-token-that-must-never-leave-the-device'
  const syncOn = (): SyncStateRow => ({
    ...defaultSyncState({
      url: 'https://abcdefghijklmnopqrst.supabase.co',
      anonKey: 'sb_publishable_abc',
      email: 'ana@example.com',
    }),
    enabled: true,
    deviceId: 'device-here',
    phase: 'steady',
    pullCursor: 42,
    session: {
      accessToken: TOKEN,
      refreshToken: 'refresh',
      expiresAt: NOW + DAY,
      userId: 'user-1',
      email: 'ana@example.com',
    },
  })

  /** Sync switched on for this device: its row, tracking on, and a change waiting. */
  async function turnSyncOn(): Promise<void> {
    await db.syncState.put(syncOn())
    db.syncTracker.setEnabled(true)
    await db.parkingLot.put({
      id: 'park-sync',
      createdAt: 1,
      updatedAt: 1,
      text: 'Ask about the OA',
      status: 'open',
      sessionId: null,
      taskId: null,
    })
    expect(await db.syncOutbox.count()).toBe(1)
  }

  afterEach(() => {
    db.syncTracker.setEnabled(false)
  })

  it('is never in an export, a safety copy or a snapshot', async () => {
    await seedEverything()
    await turnSyncOn()
    const { file, json } = await exportBackup(NOW, VERSION)
    expect(Object.keys(file.tables)).not.toContain('syncState')
    expect(Object.keys(file.tables)).not.toContain('syncOutbox')
    expect(json).not.toContain(TOKEN)

    const copy = await createSafetyCopy('pre-import', NOW, VERSION)
    expect(copy.download.json).not.toContain(TOKEN)
    const snap = await takeSnapshot('pre-sync', { now: NOW, appVersion: VERSION })
    expect(await db.snapshots.count()).toBe(2)
    for (const row of await db.snapshots.toArray()) {
      const text = await readSnapshotText(row.id)
      expect(text).not.toContain(TOKEN)
      const tables = (JSON.parse(text) as { tables: Record<string, unknown> }).tables
      expect(Object.keys(tables)).not.toContain('syncOutbox')
      expect(Object.keys(tables)).not.toContain('syncState')
    }
    expect(snap?.reason).toBe('pre-sync')
  })

  it('an import keeps this device’s sync set-up, and with sync on queues what it replaced', async () => {
    await seedEverything()
    const { file } = await exportBackup(NOW, VERSION)
    await Promise.all(db.tables.map((t) => t.clear()))
    await turnSyncOn()
    // A file from elsewhere that (wrongly) carries another device's bookkeeping.
    const foreign = {
      ...file,
      tables: {
        ...file.tables,
        syncState: [{ ...syncOn(), deviceId: 'device-elsewhere', session: null }],
        syncOutbox: [{ tbl: 'tasks', id: 'from-the-file', at: 1 }],
      },
    }
    const parsed = parseBackup(JSON.stringify(foreign), BACKUP_CONTEXT)
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    expect(parsed.warnings).toEqual([])
    await importBackup(parsed.file, NOW)

    expect(await db.syncState.toArray()).toEqual([syncOn()])
    const queued = (await db.syncOutbox.toArray()).map((e) => `${e.tbl}:${e.id}`)
    expect(queued).not.toContain('tasks:from-the-file')
    expect(queued).toContain('parkingLot:park-sync')
    expect(queued.length).toBeGreaterThan(50)
  })

  it('reset stops sync: tracking off here and in other tabs, bookkeeping cleared, nothing queued', async () => {
    await seedEverything()
    await turnSyncOn()
    const otherTab = new ForgeDB(`forge-other-tab-${Math.random().toString(36).slice(2)}`)
    otherTab.syncTracker.setEnabled(true)
    db.syncTracker.listen()
    otherTab.syncTracker.listen()
    try {
      await resetAllData()
      expect(db.syncTracker.enabled).toBe(false)
      // Polled, not slept: the other tab hears it over the BroadcastChannel (a shared machine).
      await vi.waitFor(() => expect(otherTab.syncTracker.enabled).toBe(false))
    } finally {
      db.syncTracker.unlisten()
      otherTab.syncTracker.unlisten()
      otherTab.close()
    }
    expect(await db.syncState.count()).toBe(0)
    expect(await db.syncOutbox.count()).toBe(0)
    expect(await db.tasks.count()).toBe(0)
    // The settings row made again afterwards is not queued: sync is off on this device now.
    await updateSettings({ dailyGoalPomodoros: 4 })
    expect(await db.syncOutbox.count()).toBe(0)
  })

  it('a reset that fails leaves sync on, with everything in place', async () => {
    await turnSyncOn()
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('The disk is full'))
    await expect(resetAllData()).rejects.toThrow('The disk is full')
    expect(db.syncTracker.enabled).toBe(true)
    expect(await db.syncState.get('device')).toEqual(syncOn())
    expect(await db.syncOutbox.count()).toBe(1)
  })
})

describe('weekly reminder state', () => {
  async function backdateSettings(ms: number): Promise<void> {
    await db.settings.update('app', { createdAt: ms })
  }

  it('is not due for someone with no data', async () => {
    await applySeed('empty')
    await backdateSettings(NOW - 30 * DAY)
    expect(await isBackupReminderDue(NOW)).toBe(false)
  })

  it('is not due in the first week', async () => {
    await seedEverything()
    await backdateSettings(NOW - 3 * DAY)
    expect(await isBackupReminderDue(NOW)).toBe(false)
  })

  it('is due once data is more than a week without a backup, then quiet for a week', async () => {
    await seedEverything()
    await backdateSettings(NOW - 10 * DAY)
    expect(await isBackupReminderDue(NOW)).toBe(true)
    await markReminded(NOW)
    expect(await isBackupReminderDue(NOW + DAY)).toBe(false)
    expect(await isBackupReminderDue(NOW + 8 * DAY)).toBe(true)
  })

  it('is silenced by a backup, and by the switch', async () => {
    await seedEverything()
    await backdateSettings(NOW - 10 * DAY)
    await markBackedUp(NOW - DAY)
    expect(await isBackupReminderDue(NOW)).toBe(false)
    expect(await isBackupReminderDue(NOW + 8 * DAY)).toBe(true)
    await updateSettings({ backup: { remindWeekly: false } })
    expect(await isBackupReminderDue(NOW + 8 * DAY)).toBe(false)
  })
})
