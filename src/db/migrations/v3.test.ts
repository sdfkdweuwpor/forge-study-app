/**
 * Schema v3 upgrade (cloud sync, PLAN §4.7.4): a v2 database (the WGU sample, XP, an attached PDF, a
 * trashed PDF resource and a settings row carrying the v2 `sync` field) opens as v3 losslessly: the two
 * new tables exist and are empty, `settings.sync` is gone, every other row (timestamps and Blobs
 * included) is exactly as it was, nothing is queued for sync even with tracking on, the upgrade is
 * idempotent, and a v2 backup migrates to what the database holds.
 */
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { buildStarterData } from '@/data/sample/starterTasks'
import { buildWguBsCs, COURSE_IDS, WGU_GOAL_ID } from '@/data/sample/wguBsCs'
import { ForgeDB, db as appDb } from '@/db/db'
import { defaultSettings } from '@/db/defaults'
import { upgradeV3 } from '@/db/migrations/v3'
import { BACKUP_CONTEXT, importBackup } from '@/db/repos/backup'
import { SCHEMA_VERSION, STORES_V1, TABLE_NAMES } from '@/db/schema'
import { STORES_V2_DELTA } from '@/db/migrations/v2'
import type { Resource, StoredFile, TrashItem } from '@/db/types'
import { migrateBackup, migrateBackupV2toV3, validateBackup } from '@/logic/backup'
import { atTime } from '@/logic/dates'
import { settingsToV3 } from '@/logic/schemaV3'

const TODAY = '2026-09-29'
const NOW = atTime(TODAY, '09:30')
const UPGRADE_AT = NOW + 60_000

type Row = Record<string, unknown>

const pdf = (text: string): Blob =>
  new Blob([new TextEncoder().encode(`%PDF-1.7 ${text}`)], { type: 'application/pdf' })

const V2_SYNC = { enabled: false, url: null, anonKey: null, lastSyncAt: null }

/** Every v2 table this test fills, as v2 stored it. */
function v2Tables(): Record<string, Row[]> {
  const { goal, milestones, units } = buildWguBsCs(TODAY, NOW)
  const { tasks, xpEvents } = buildStarterData({ today: TODAY, now: NOW })
  const settings: Row = {
    ...defaultSettings(NOW - 5_000),
    updatedAt: NOW - 1_000,
    sync: V2_SYNC,
  }
  const file: StoredFile = {
    id: 'file-kept',
    createdAt: 111,
    updatedAt: 222,
    name: 'C779 study guide.pdf',
    mime: 'application/pdf',
    size: 30,
    blob: pdf('C779 study guide'),
  }
  const resource: Resource = {
    id: 'res-trashed',
    createdAt: 300,
    updatedAt: 400,
    goalId: WGU_GOAL_ID,
    milestoneId: COURSE_IDS.C779,
    kind: 'pdf',
    title: 'Old syllabus',
    url: null,
    fileId: 'file-trashed',
    status: 'toRead',
    notes: '',
    order: 1,
  }
  const trash: TrashItem = {
    id: 'trash-pdf',
    createdAt: 500,
    updatedAt: 500,
    entityTable: 'resources',
    entityId: resource.id,
    title: resource.title,
    expiresAt: NOW + 1_000_000,
    payload: {
      resources: [resource],
      files: [
        {
          id: 'file-trashed',
          createdAt: 300,
          updatedAt: 300,
          name: 'old.pdf',
          mime: 'application/pdf',
          size: 20,
          blob: pdf('old syllabus'),
        } satisfies StoredFile,
      ],
    },
  }
  return {
    settings: [settings],
    goals: [goal as unknown as Row],
    milestones: milestones as unknown as Row[],
    units: units as unknown as Row[],
    tasks: tasks as unknown as Row[],
    xpEvents: xpEvents as unknown as Row[],
    files: [file as unknown as Row],
    trash: [trash as unknown as Row],
  }
}

/** Rows as comparable data: every Blob, at any depth, becomes its type and bytes. */
async function plain(value: unknown): Promise<unknown> {
  if (value instanceof Blob)
    return { blob: value.type, bytes: Array.from(new Uint8Array(await value.arrayBuffer())) }
  if (Array.isArray(value)) return Promise.all(value.map(plain))
  if (typeof value === 'object' && value !== null) {
    const out: Row = {}
    for (const [k, v] of Object.entries(value)) out[k] = await plain(v)
    return out
  }
  return value
}

const byId = (a: Row, b: Row) => String(a.id).localeCompare(String(b.id))

let name = ''
let opened: ForgeDB | null = null

afterEach(async () => {
  opened?.close()
  if (name) await Dexie.delete(name)
  opened = null
  name = ''
})

/** Creates a v2 database (as the v2 build declared it), fills it, and reopens it with the current schema. */
async function openUpgraded(opts: { trackingOn?: boolean } = {}): Promise<ForgeDB> {
  name = `forge-migration-v3-${Math.random().toString(36).slice(2)}`
  const v2 = new Dexie(name)
  v2.version(1).stores(STORES_V1)
  v2.version(2).stores(STORES_V2_DELTA)
  const tables = v2Tables()
  await v2.transaction('rw', v2.tables, async () => {
    for (const [table, rows] of Object.entries(tables)) await v2.table(table).bulkAdd(rows)
  })
  expect(v2.verno).toBe(2)
  v2.close()
  opened = new ForgeDB(name, () => UPGRADE_AT)
  // With sync switched on before the upgrade runs, the upgrade must still queue nothing.
  if (opts.trackingOn) opened.syncTracker.setEnabled(true)
  await opened.open()
  return opened
}

describe('schema v2 → v3', () => {
  it('opens at version 3 with every table; the sync tables are new and empty', async () => {
    const db = await openUpgraded()
    expect(SCHEMA_VERSION).toBe(3)
    expect(db.verno).toBe(3)
    expect(db.tables.map((t) => t.name).sort()).toEqual([...TABLE_NAMES].sort())
    expect(await db.syncOutbox.count()).toBe(0)
    expect(await db.syncState.count()).toBe(0)
    // No syncState row: sync is off after the upgrade.
    expect(db.syncTracker.enabled).toBe(false)
  })

  it('removes settings.sync and keeps every other setting and its timestamps', async () => {
    const db = await openUpgraded()
    const stored = (await db.settings.get('app')) as unknown as Row
    const expected = { ...(v2Tables().settings?.[0] as Row) }
    delete expected.sync
    expect('sync' in stored).toBe(false)
    expect(stored).toEqual(expected)
  })

  it('is lossless: every other row, timestamps and Blobs included, is exactly as it was', async () => {
    const db = await openUpgraded()
    for (const [table, rows] of Object.entries(v2Tables())) {
      if (table === 'settings') continue
      const now = (await db.table(table).toArray()) as Row[]
      expect(await plain(now.sort(byId)), table).toEqual(await plain([...rows].sort(byId)))
    }
    // The trashed PDF's bytes survive inside the trash payload.
    const trash = await db.trash.get('trash-pdf')
    const blob = (trash?.payload.files?.[0] as StoredFile | undefined)?.blob
    expect(blob).toBeInstanceOf(Blob)
    expect(await blob?.text()).toBe('%PDF-1.7 old syllabus')
  })

  it('queues nothing for sync, even when tracking is on while it runs', async () => {
    const db = await openUpgraded({ trackingOn: true })
    expect(await db.syncOutbox.count()).toBe(0)
  })

  it('is idempotent: running the upgrade again changes nothing', async () => {
    const db = await openUpgraded()
    const snapshot = async () =>
      plain(
        Object.fromEntries(
          await Promise.all(db.tables.map(async (t) => [t.name, await t.toArray()] as const)),
        ),
      )
    const before = await snapshot()
    await db.transaction('rw', db.tables, (tx) => upgradeV3(tx))
    expect(await snapshot()).toEqual(before)
    const settings = await db.settings.get('app')
    expect(settingsToV3(settings)).toBe(settings)
    db.close()
    const again = new ForgeDB(name, () => UPGRADE_AT + 10_000)
    await again.open()
    expect(await plain(await again.tasks.toArray())).toEqual((before as Row).tasks)
    again.close()
  })

  it('a v2 backup migrates to exactly what the upgraded database holds', async () => {
    const db = await openUpgraded()
    const file = { app: 'forge', format: 1, schemaVersion: 2, tables: v2Tables() }
    const migrated = migrateBackupV2toV3(file, UPGRADE_AT)
    expect(migrated.schemaVersion).toBe(3)
    for (const [table, rows] of Object.entries(migrated.tables)) {
      const inDb = (await db.table(table).toArray()) as Row[]
      expect(await plain([...(rows as Row[])].sort(byId)), table).toEqual(
        await plain(inDb.sort(byId)),
      )
    }
    // A v3 file is left alone.
    expect(migrateBackupV2toV3(migrated, UPGRADE_AT)).toBe(migrated)
  })

  it('drops sync bookkeeping a file should never carry, and brings a v1 file all the way', () => {
    const v2 = {
      schemaVersion: 2,
      tables: {
        settings: [{ id: 'app', sync: V2_SYNC }],
        syncOutbox: [{ tbl: 'tasks', id: 't', at: 1 }],
        syncState: [{ id: 'device' }],
      },
    }
    const out = migrateBackupV2toV3(v2, NOW)
    expect(out.tables).toEqual({ settings: [{ id: 'app' }] })

    const v1 = { schemaVersion: 1, tables: { settings: [{ id: 'app', sync: V2_SYNC }], tasks: [] } }
    const up = migrateBackup(v1, SCHEMA_VERSION, NOW)
    expect(up.schemaVersion).toBe(3)
    expect(up.tables.settings?.[0]).not.toHaveProperty('sync')
  })

  it('importing a v2 backup leaves no settings.sync behind', async () => {
    await Promise.all(appDb.tables.map((t) => t.clear()))
    const parsed = validateBackup(
      {
        app: 'forge',
        format: 1,
        schemaVersion: 2,
        exportedAt: new Date(NOW).toISOString(),
        tables: v2Tables(),
      },
      BACKUP_CONTEXT,
    )
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    const result = await importBackup(parsed.file, NOW)
    expect(result.fromVersion).toBe(2)
    const settings = (await appDb.settings.get('app')) as unknown as Row
    expect('sync' in settings).toBe(false)
    expect(await appDb.tasks.count()).toBe(v2Tables().tasks?.length)
    expect(await appDb.syncOutbox.count()).toBe(0)
    await Promise.all(appDb.tables.map((t) => t.clear()))
  })
})
