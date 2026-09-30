/**
 * Cloud sync change tracking (PLAN §4.7.4). Two groups:
 * - the Dexie facts the middleware relies on (each would break silently on a Dexie upgrade), and
 * - every write path the app has, with sync on (the expected outbox entries) and off (none, and no
 *   change to a transaction's scope).
 */
import Dexie, { liveQuery } from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySeed } from '@/dev/seed'
import { ForgeDB, db } from '@/db/db'
import { settleDomainEvents } from '@/db/events'
import { BACKUP_CONTEXT, exportBackup, importBackup, resetAllData } from '@/db/repos/backup'
import { updateSettings, ensureSettings } from '@/db/repos/settings'
import { restoreSnapshot, takeSnapshot } from '@/db/repos/snapshots'
import { createTask, completeTask } from '@/db/repos/tasks'
import { purgeTrashItem, restoreFromTrash } from '@/db/repos/trash'
import { awardXp } from '@/db/repos/xp'
import { TABLE_NAMES } from '@/db/schema'
import type { BlockEvent, Reward, SyncStateRow } from '@/db/types'
import { parseBackup } from '@/logic/backup'
import { LOCAL_TABLES, SYNC_TABLES } from '@/logic/syncTables'
import { markRemoteApply, markUntracked } from './remoteApply'
import { OUTBOX_TABLE } from './tracking'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()

const reward = (id: string, over: Partial<Reward> = {}): Reward => ({
  id,
  createdAt: 100,
  updatedAt: 100,
  title: `Reward ${id}`,
  icon: '🎮',
  price: 300,
  description: '',
  archived: false,
  order: 1,
  ...over,
})

const blockEvent = (id: string): BlockEvent => ({
  id,
  createdAt: 50,
  updatedAt: 50,
  at: 50,
  day: '2026-09-29',
  kind: 'attempt',
  domain: 'instagram.com',
  minutes: null,
})

/** The outbox as sorted `table:id` strings. */
async function outbox(): Promise<string[]> {
  return (await db.syncOutbox.toArray()).map((e) => `${e.tbl}:${e.id}`).sort()
}

async function clearAll(): Promise<void> {
  db.syncTracker.setEnabled(false)
  await Promise.all(db.tables.map((t) => t.clear()))
}

beforeEach(clearAll)
afterEach(async () => {
  await settleDomainEvents()
  await clearAll()
})

describe('the table partition', () => {
  it('splits every table into synced (26) and local (7), with no overlap', () => {
    const synced = new Set<string>(SYNC_TABLES)
    const local = new Set<string>(LOCAL_TABLES)
    expect(synced.size).toBe(26)
    expect(local.size).toBe(7)
    expect([...synced].filter((t) => local.has(t))).toEqual([])
    expect([...synced, ...local].sort()).toEqual([...TABLE_NAMES].sort())
  })
})

describe('with sync off', () => {
  it('queues nothing and does not widen a transaction', async () => {
    expect(db.syncTracker.enabled).toBe(false)
    let stores: string[] = []
    await db.transaction('rw', db.rewards, async (tx) => {
      await db.rewards.put(reward('a'))
      await db.rewards.update('a', { price: 400 })
      await db.rewards.delete('a')
      stores = Array.from((tx.idbtrans as IDBTransaction).objectStoreNames)
    })
    await db.rewards.bulkPut([reward('b'), reward('c')])
    await db.rewards.clear()
    expect(stores).toEqual(['rewards'])
    expect(await outbox()).toEqual([])
  })
})

describe('Dexie facts the tracking relies on', () => {
  beforeEach(() => db.syncTracker.setEnabled(true))

  it('widens a read-write transaction on a synced table to the outbox (natively)', async () => {
    let stores: string[] = []
    await db.transaction('rw', db.rewards, async (tx) => {
      await db.rewards.put(reward('a'))
      stores = Array.from((tx.idbtrans as IDBTransaction).objectStoreNames).sort()
    })
    expect(stores).toEqual(['rewards', OUTBOX_TABLE])
    expect(await outbox()).toEqual(['rewards:a'])
  })

  it('leaves read-only transactions and transactions on local tables alone', async () => {
    let readStores: string[] = []
    let localStores: string[] = []
    await db.transaction('r', db.rewards, async (tx) => {
      await db.rewards.toArray()
      readStores = Array.from((tx.idbtrans as IDBTransaction).objectStoreNames)
    })
    await db.transaction('rw', db.streakDays, db.worldTiles, async (tx) => {
      await db.streakDays.put({
        id: '2026-09-29',
        createdAt: 1,
        updatedAt: 1,
        day: '2026-09-29',
        focusMinutes: 50,
        focusSessions: 2,
        pomodoros: 2,
        tasksDone: 1,
        dailyGoalTarget: 6,
        dailyGoalHit: false,
        qualified: true,
        xp: 50,
      })
      localStores = Array.from((tx.idbtrans as IDBTransaction).objectStoreNames).sort()
    })
    expect(readStores).toEqual(['rewards'])
    expect(localStores).toEqual(['streakDays', 'worldTiles'])
    expect(await outbox()).toEqual([])
  })

  it('receives the transaction’s idbtrans as req.trans: a marked transaction is not queued', async () => {
    await db.transaction('rw', db.rewards, async (tx) => {
      markUntracked(tx.idbtrans)
      await db.rewards.put(reward('a'))
    })
    expect(await outbox()).toEqual([])
    expect(await db.rewards.get('a')).toBeDefined()
  })

  it('a remote-apply transaction is not queued and keeps the timestamps rows arrive with', async () => {
    await db.rewards.put(reward('a'))
    await db.syncOutbox.clear()
    await db.transaction('rw', db.rewards, async (tx) => {
      markRemoteApply(tx.idbtrans)
      await db.rewards.put(reward('a', { price: 900, updatedAt: 100 }))
      await db.rewards.update('a', { title: 'From the laptop' })
      await db.rewards.add({ ...reward('b'), createdAt: undefined, updatedAt: undefined } as never)
    })
    expect(await outbox()).toEqual([])
    expect(await db.rewards.get('a')).toMatchObject({ price: 900, updatedAt: 100 })
    const b = await db.rewards.get('b')
    expect(b?.createdAt).toBeUndefined()
    // An ordinary write is still stamped.
    await db.rewards.update('a', { price: 1 })
    expect((await db.rewards.get('a'))?.updatedAt).toBeGreaterThan(100)
  })

  it('tracks a nested transaction once, through its parent', async () => {
    await db.transaction('rw', db.rewards, db.tasks, async () => {
      await db.transaction('rw', db.rewards, async () => {
        await db.rewards.put(reward('inner'))
      })
      await db.rewards.put(reward('outer'))
    })
    expect(await outbox()).toEqual(['rewards:inner', 'rewards:outer'])
  })

  it('rolls queued entries back with an aborted transaction', async () => {
    await expect(
      db.transaction('rw', db.rewards, async () => {
        await db.rewards.put(reward('a'))
        throw new Error('changed my mind')
      }),
    ).rejects.toThrow('changed my mind')
    expect(await db.rewards.count()).toBe(0)
    expect(await outbox()).toEqual([])
  })

  it('does not queue the key of a failed operation in a bulk write', async () => {
    await db.rewards.put(reward('a'))
    await db.syncOutbox.clear()
    await db.transaction('rw', db.rewards, async () => {
      await db.rewards.bulkAdd([reward('a'), reward('b')]).catch(() => undefined)
    })
    expect(await outbox()).toEqual(['rewards:b'])
  })

  it('writes the outbox through Dexie’s observability layer (live queries see it)', async () => {
    const seen: number[] = []
    const sub = liveQuery(() => db.syncOutbox.count()).subscribe((n) => seen.push(n))
    await new Promise((r) => setTimeout(r, 20))
    await db.rewards.put(reward('a'))
    await new Promise((r) => setTimeout(r, 20))
    await db.rewards.put(reward('b'))
    await new Promise((r) => setTimeout(r, 20))
    sub.unsubscribe()
    expect(seen).toEqual([0, 1, 2])
  })

  it('does not track an upgrade transaction, even with tracking on', async () => {
    const name = `forge-tracking-upgrade-${Math.random().toString(36).slice(2)}`
    const first = new ForgeDB(name)
    await first.rewards.put(reward('a'))
    first.close()

    class NextVersion extends ForgeDB {
      constructor() {
        super(name)
        this.version(4)
          .stores({})
          .upgrade((tx) =>
            tx
              .table('rewards')
              .toCollection()
              .modify((r: Reward) => {
                r.price = 999
              }),
          )
      }
    }
    const next = new NextVersion()
    next.syncTracker.setEnabled(true)
    await next.open()
    expect((await next.rewards.get('a'))?.price).toBe(999)
    expect(await next.syncOutbox.count()).toBe(0)
    next.close()
    await Dexie.delete(name)
  })
})

describe('every write path, with sync on', () => {
  beforeEach(() => db.syncTracker.setEnabled(true))

  it('add, put, bulkPut, update, modify, delete, bulkDelete, where().delete() and clear()', async () => {
    await db.rewards.add(reward('add'))
    await db.rewards.put(reward('put'))
    await db.rewards.bulkPut([reward('bp1'), reward('bp2')])
    expect(await outbox()).toEqual(['rewards:add', 'rewards:bp1', 'rewards:bp2', 'rewards:put'])

    await db.syncOutbox.clear()
    await db.rewards.update('add', { price: 1 })
    await db.rewards.where('id').equals('put').modify({ price: 2 })
    expect(await outbox()).toEqual(['rewards:add', 'rewards:put'])

    await db.syncOutbox.clear()
    await db.rewards.delete('add')
    await db.rewards.bulkDelete(['bp1'])
    await db.rewards.where('id').equals('bp2').delete()
    expect(await outbox()).toEqual(['rewards:add', 'rewards:bp1', 'rewards:bp2'])

    await db.syncOutbox.clear()
    await db.rewards.clear()
    expect(await outbox()).toEqual(['rewards:put'])
  })

  it('keeps one entry per record, carrying the newest stamp', async () => {
    await db.rewards.put(reward('a'))
    const first = (await db.syncOutbox.toArray())[0]?.at ?? 0
    await db.rewards.update('a', { price: 1 })
    await db.rewards.update('a', { price: 2 })
    const entries = await db.syncOutbox.toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.at).toBeGreaterThan(first)
  })

  it('never queues local tables', async () => {
    await db.files.put({
      id: 'f1',
      createdAt: 1,
      updatedAt: 1,
      name: 'a.pdf',
      mime: 'application/pdf',
      size: 3,
      blob: new Blob(['%PD']),
    })
    await takeSnapshot('manual', { now: NOW, appVersion: 'test' })
    expect(await outbox()).toEqual([])
  })

  it('settings: queued when a synced field changes, not for device-only fields', async () => {
    await ensureSettings()
    expect(await outbox()).toEqual(['settings:app'])
    await db.syncOutbox.clear()

    await updateSettings({ appearance: { theme: 'dark', accent: 'teal' } })
    await updateSettings({ blocker: { eventsCursor: 12345, lastSyncedAt: NOW } })
    await updateSettings({ notifications: { enabled: true, promptedAt: NOW } })
    await updateSettings({ backup: { lastRemindedAt: NOW } })
    expect(await outbox()).toEqual([])

    await updateSettings({ dailyGoalPomodoros: 8 })
    expect(await outbox()).toEqual(['settings:app'])
  })

  it('append-only tables: a row written again is not a change', async () => {
    await db.blockEvents.bulkPut([blockEvent('e1'), blockEvent('e2')])
    expect(await outbox()).toEqual(['blockEvents:e1', 'blockEvents:e2'])
    await db.syncOutbox.clear()
    await db.blockEvents.bulkPut([blockEvent('e1'), blockEvent('e2'), blockEvent('e3')])
    expect(await outbox()).toEqual(['blockEvents:e3'])
  })

  it('a task completion queues the task and its XP event (deterministic id)', async () => {
    const task = await createTask({ title: 'Read C182 chapter 4' }, { now: NOW })
    await db.syncOutbox.clear()
    await completeTask(task.id, { now: NOW })
    expect(await outbox()).toEqual([`tasks:${task.id}`, `xpEvents:xp:task:${task.id}#0`])
  })

  it('trash move, restore and purge become tombstones and puts', async () => {
    const task = await createTask({ title: 'Old errand' }, { now: NOW })
    await db.syncOutbox.clear()
    const trashed = await import('@/db/repos/trash').then((m) => m.moveToTrash('tasks', task.id))
    const trashId = trashed?.trashId ?? ''
    expect(await db.tasks.get(task.id)).toBeUndefined()
    // The task's entry is a tombstone at push time (the row is gone); the trash row is new.
    expect(await outbox()).toEqual([`tasks:${task.id}`, `trash:${trashId}`].sort())

    await db.syncOutbox.clear()
    await restoreFromTrash(trashId)
    expect(await outbox()).toEqual([`tasks:${task.id}`, `trash:${trashId}`].sort())

    const again = await import('@/db/repos/trash').then((m) => m.moveToTrash('tasks', task.id))
    await db.syncOutbox.clear()
    await purgeTrashItem(again?.trashId ?? '')
    expect(await outbox()).toEqual([`trash:${again?.trashId ?? ''}`])
  })

  it('an import replaces: every restored row and every row it removed is queued', async () => {
    db.syncTracker.setEnabled(false)
    await applySeed('wgu')
    const { json } = await exportBackup(NOW, 'test')
    await db.rewards.put(reward('added-after-export'))
    db.syncTracker.setEnabled(true)

    const parsed = parseBackup(json, BACKUP_CONTEXT)
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    await importBackup(parsed.file, NOW)

    const queued = new Set(await outbox())
    expect(queued.has('rewards:added-after-export')).toBe(true)
    expect(await db.rewards.get('added-after-export')).toBeUndefined()
    for (const t of await db.tasks.toArray()) expect(queued.has(`tasks:${t.id}`)).toBe(true)
    expect(queued.has('settings:app')).toBe(true)
    expect([...queued].some((k) => k.startsWith('streakDays:') || k.startsWith('files:'))).toBe(
      false,
    )
  })

  it('a snapshot restore replaces the same way', async () => {
    db.syncTracker.setEnabled(false)
    await applySeed('wgu')
    const snap = await takeSnapshot('manual', { now: NOW, appVersion: 'test' })
    await db.rewards.put(reward('after-snapshot'))
    db.syncTracker.setEnabled(true)
    await restoreSnapshot(snap?.id ?? '', { now: NOW, appVersion: 'test' })
    const queued = await outbox()
    expect(queued).toContain('rewards:after-snapshot')
    expect(queued.some((k) => k.startsWith('snapshots:'))).toBe(false)
  })

  it('reset erases this device only: tracking off, outbox and syncState cleared, nothing queued', async () => {
    await db.rewards.put(reward('a'))
    const state: SyncStateRow = {
      id: 'device',
      enabled: true,
      url: 'https://abcdefghijklmnopqrst.supabase.co',
      anonKey: 'sb_publishable_x',
      email: 'ana@example.com',
      session: null,
      pendingLogin: null,
      deviceId: 'dev-1',
      accountUserId: null,
      phase: 'steady',
      pullCursor: 42,
      maxSeenStamp: 0,
      lastSyncAt: null,
      lastAttemptAt: null,
      lastError: null,
      clockSkewMs: null,
    }
    await db.syncState.put(state)
    expect(await outbox()).toEqual(['rewards:a'])

    await resetAllData()
    expect(db.syncTracker.enabled).toBe(false)
    expect(await db.syncState.count()).toBe(0)
    expect(await outbox()).toEqual([])
    // The settings row made again after the reset is not queued either (sync is off now).
    expect(await db.settings.count()).toBe(1)
  })

  it('XP awards are queued under their deterministic ids', async () => {
    await awardXp({ source: 'dailyGoal', amount: 25, key: 'dailyGoal:2026-09-29', at: NOW })
    expect(await outbox()).toEqual(['xpEvents:xp:dailyGoal:2026-09-29#0'])
  })
})

describe('stamps, listeners and loading', () => {
  it('stamps strictly increase with a frozen clock and stay past the newest remote stamp', () => {
    const name = `forge-tracking-stamp-${Math.random().toString(36).slice(2)}`
    const frozen = new ForgeDB(name, () => 1_000)
    const a = frozen.syncTracker.stamp()
    const b = frozen.syncTracker.stamp()
    expect(a).toBe(1_000)
    expect(b).toBe(1_001)
    frozen.syncTracker.seed({ maxSeenStamp: 5_000 })
    expect(frozen.syncTracker.stamp()).toBe(5_001)
    frozen.close()
  })

  it('tells listeners about tracked writes, and a failing listener does not fail the write', async () => {
    db.syncTracker.setEnabled(true)
    let calls = 0
    const offBad = db.syncTracker.onTrackedWrite(() => {
      throw new Error('listener bug')
    })
    const off = db.syncTracker.onTrackedWrite(() => {
      calls += 1
    })
    await db.rewards.put(reward('a'))
    off()
    offBad()
    await db.rewards.put(reward('b'))
    expect(calls).toBe(1)
    expect(await db.rewards.count()).toBe(2)
  })

  it('loads the flag and the stamp floor from the database on every open', async () => {
    const name = `forge-tracking-load-${Math.random().toString(36).slice(2)}`
    const first = new ForgeDB(name, () => 1_000)
    await first.open()
    expect(first.syncTracker.enabled).toBe(false)
    await first.table('syncState').put({ id: 'device', enabled: true, maxSeenStamp: 7_000 })
    await first.table(OUTBOX_TABLE).put({ tbl: 'tasks', id: 't1', at: 9_000 })
    first.close()

    const second = new ForgeDB(name, () => 1_000)
    await second.open()
    expect(second.syncTracker.enabled).toBe(true)
    expect(second.syncTracker.stamp()).toBe(9_001)
    // Sticky: a close and reopen reads it again.
    await second.table('syncState').put({ id: 'device', enabled: false, maxSeenStamp: 0 })
    second.close()
    await second.open()
    expect(second.syncTracker.enabled).toBe(false)
    second.close()
    await Dexie.delete(name)
  })
})
