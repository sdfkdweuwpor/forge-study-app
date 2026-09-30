/**
 * Cloud sync change tracking (PLAN §4.7.4). Two groups:
 * - the Dexie facts the middleware relies on (each would break silently on a Dexie upgrade), and
 * - every write path the app has, with sync on (the expected outbox entries) and off (none, and no
 *   change to a transaction's scope).
 */
import Dexie, {
  liveQuery,
  type DBCore,
  type DBCoreMutateRequest,
  type DBCoreMutateResponse,
  type DBCoreTable,
  type DBCoreTransaction,
} from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WGU_GOAL_ID } from '@/data/sample/wguBsCs'
import { applySeed } from '@/dev/seed'
import { ForgeDB, db } from '@/db/db'
import { defaultSyncState } from '@/db/defaults'
import { settleDomainEvents } from '@/db/events'
import { BACKUP_CONTEXT, exportBackup, importBackup, resetAllData } from '@/db/repos/backup'
import { rebalanceGoal } from '@/db/repos/goals'
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
import { OUTBOX_TABLE, SyncTracker } from './tracking'

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

const DAY = 24 * 60 * 60 * 1000

/** Every synced row as `table:id` → its JSON. */
async function syncedRows(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const name of SYNC_TABLES)
    for (const row of (await db.table(name).toArray()) as { id: string }[])
      out.set(`${name}:${row.id}`, JSON.stringify(row))
  return out
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
  it('queues nothing on any write path and does not widen a transaction', async () => {
    expect(db.syncTracker.enabled).toBe(false)
    const scopes: string[][] = []
    const scopeOf = (tx: { idbtrans: IDBTransaction }) =>
      scopes.push(Array.from(tx.idbtrans.objectStoreNames).sort())

    await db.transaction('rw', db.rewards, async (tx) => {
      await db.rewards.add(reward('add'))
      await db.rewards.put(reward('a'))
      await db.rewards.update('a', { price: 400 })
      await db.rewards.delete('a')
      scopeOf(tx)
    })
    await db.transaction('rw', db.tasks, db.goals, db.xpEvents, db.settings, async (tx) => {
      await ensureSettings()
      await db.xpEvents.put({
        id: 'xp:t#0',
        createdAt: 1,
        updatedAt: 1,
        at: 1,
        day: '2026-09-29',
        source: 'task',
        amount: 15,
        key: 't',
        refId: null,
        note: null,
      })
      scopeOf(tx)
    })
    await db.rewards.bulkAdd([reward('ba1'), reward('ba2')])
    await db.rewards.bulkPut([reward('b'), reward('c')])
    await db.rewards.bulkUpdate([{ key: 'b', changes: { price: 1 } }])
    await db.rewards.upsert('up', { ...reward('up') })
    await db.rewards
      .where('id')
      .equals('c')
      .modify((r) => {
        r.price = 7
      })
    await db.rewards.bulkDelete(['b'])
    await db.rewards.where('id').equals('c').delete()
    await db.rewards.clear()
    await updateSettings({ dailyGoalPomodoros: 9 })
    await db.blockEvents.bulkPut([blockEvent('e1')])

    expect(scopes).toEqual([['rewards'], ['goals', 'settings', 'tasks', 'xpEvents']])
    expect(await outbox()).toEqual([])
  })

  it('is a strict pass-through: the same scope, the same request, the same promise, nothing read', async () => {
    const calls: string[] = []
    const trans: DBCoreTransaction = { abort: () => undefined }
    const response: Promise<DBCoreMutateResponse> = Promise.resolve({
      numFailures: 0,
      failures: {},
      lastResult: undefined,
    })
    const tables = new Map<string, DBCoreTable>()
    const stubTable = (name: string): DBCoreTable => ({
      name,
      schema: {
        name,
        primaryKey: { name: null, keyPath: 'id', extractKey: (v: { id: string }) => v.id },
        indexes: [],
        getIndexByKeyPath: () => undefined,
      },
      mutate: () => {
        calls.push(`${name}.mutate`)
        return response
      },
      get: () => {
        calls.push(`${name}.get`)
        return Promise.resolve(undefined)
      },
      getMany: () => {
        calls.push(`${name}.getMany`)
        return Promise.resolve([])
      },
      query: () => {
        calls.push(`${name}.query`)
        return Promise.resolve({ result: [] })
      },
      openCursor: () => Promise.resolve(null),
      count: () => Promise.resolve(0),
    })
    let scope: string[] = []
    const down: DBCore = {
      stack: 'dbcore',
      MIN_KEY: -Infinity,
      MAX_KEY: [[]],
      schema: { name: 'stub', tables: [] },
      transaction: (stores) => {
        scope = stores
        return trans
      },
      table: (name) => {
        const known = tables.get(name)
        if (known) return known
        const made = stubTable(name)
        tables.set(name, made)
        return made
      },
    }
    const core = new SyncTracker(() => 1).middleware.create(down)
    if (!core.transaction || !core.table) throw new Error('the middleware must wrap both')

    const stores = ['settings', 'rewards']
    expect(core.transaction(stores, 'readwrite')).toBe(trans)
    expect(scope).toBe(stores)
    // A local table is not wrapped at all.
    expect(core.table('files')).toBe(down.table('files'))
    const requests: DBCoreMutateRequest[] = [
      { type: 'put', trans, values: [{ id: 'app' }] },
      { type: 'add', trans, values: [{ id: 'r1' }] },
      { type: 'delete', trans, keys: ['r1'] },
      { type: 'deleteRange', trans, range: { type: 3, lower: -Infinity, upper: [[]] } },
    ]
    for (const req of requests) {
      const table = req.type === 'put' ? 'settings' : 'rewards'
      expect(core.table(table).mutate(req)).toBe(response)
    }
    expect(calls).toEqual(['settings.mutate', 'rewards.mutate', 'rewards.mutate', 'rewards.mutate'])
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
    // Polled, not slept: the suite runs on a shared machine.
    await vi.waitFor(() => expect(seen).toEqual([0]))
    await db.rewards.put(reward('a'))
    await vi.waitFor(() => expect(seen).toEqual([0, 1]))
    await db.rewards.put(reward('b'))
    await vi.waitFor(() => expect(seen).toEqual([0, 1, 2]))
    sub.unsubscribe()
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
    const before = await syncedRows()
    db.syncTracker.setEnabled(true)

    const parsed = parseBackup(json, BACKUP_CONTEXT)
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    await importBackup(parsed.file, NOW)

    expect(await db.rewards.get('added-after-export')).toBeUndefined()
    // Exactly the synced rows before and after: a missed key would be a device that never converges.
    const after = await syncedRows()
    const expected = [...new Set([...before.keys(), ...after.keys()])].sort()
    expect(expected).toContain('rewards:added-after-export')
    expect(expected).toContain('settings:app')
    expect(expected.length).toBeGreaterThan(50)
    expect(await outbox()).toEqual(expected)
  })

  it('a snapshot restore replaces the same way', async () => {
    db.syncTracker.setEnabled(false)
    await applySeed('wgu')
    const snap = await takeSnapshot('manual', { now: NOW, appVersion: 'test' })
    await db.rewards.put(reward('after-snapshot'))
    const before = await syncedRows()
    db.syncTracker.setEnabled(true)
    await restoreSnapshot(snap?.id ?? '', { now: NOW, appVersion: 'test' })
    const after = await syncedRows()
    const expected = [...new Set([...before.keys(), ...after.keys()])].sort()
    expect(expected).toContain('rewards:after-snapshot')
    expect(expected.length).toBeGreaterThan(50)
    // Exactly those keys; the snapshot rows themselves (local) never are.
    expect(await outbox()).toEqual(expected)
  })

  it('reset erases this device only: tracking off, outbox and syncState cleared, nothing queued', async () => {
    await db.rewards.put(reward('a'))
    const state: SyncStateRow = {
      ...defaultSyncState({
        url: 'https://abcdefghijklmnopqrst.supabase.co',
        anonKey: 'sb_publishable_x',
        email: 'ana@example.com',
      }),
      enabled: true,
      deviceId: 'dev-1',
      phase: 'steady',
      pullCursor: 42,
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

  it('writes the entry inside the same transaction as the change (visible before commit)', async () => {
    let inside: unknown
    let stores: string[] = []
    await db.transaction('rw', db.rewards, db.goals, db.syncOutbox, async (tx) => {
      await db.rewards.put(reward('a'))
      inside = await db.syncOutbox.get(['rewards', 'a'])
      stores = Array.from((tx.idbtrans as IDBTransaction).objectStoreNames).sort()
    })
    expect(inside).toMatchObject({ tbl: 'rewards', id: 'a' })
    // Declaring the outbox yourself does not add it twice.
    expect(stores).toEqual(['goals', 'rewards', OUTBOX_TABLE])
  })

  it('queues every table a multi-table transaction writes, and nothing it only read', async () => {
    await db.rewards.put(reward('read-only'))
    await db.syncOutbox.clear()
    const task = await createTask({ title: 'Outline D278 essay' }, { now: NOW })
    await db.syncOutbox.clear()
    await db.transaction('rw', [db.tasks, db.rewards, db.xpEvents, db.redemptions], async () => {
      await db.rewards.get('read-only')
      await db.tasks.update(task.id, { priority: 3 })
      await awardXp({ source: 'task', amount: 15, key: `task:${task.id}`, at: NOW })
    })
    expect(await outbox()).toEqual([`tasks:${task.id}`, `xpEvents:xp:task:${task.id}#0`])
  })

  it('also covers bulkAdd, bulkUpdate, upsert and a modify callback; a no-op update queues nothing', async () => {
    await db.rewards.bulkAdd([reward('ba1'), reward('ba2')])
    await db.rewards.put(reward('bu'))
    await db.syncOutbox.clear()
    await db.rewards.bulkUpdate([
      { key: 'bu', changes: { price: 5 } },
      { key: 'missing', changes: { price: 5 } },
    ])
    await db.rewards.upsert('up', { ...reward('up') })
    await db.rewards
      .where('id')
      .equals('ba1')
      .modify((r) => {
        r.archived = true
      })
    await db.rewards.update('nobody', { price: 1 })
    expect(await outbox()).toEqual(['rewards:ba1', 'rewards:bu', 'rewards:up'])
  })

  it('a re-plan queues every record it changed', async () => {
    db.syncTracker.setEnabled(false)
    await applySeed('wgu')
    const before = await syncedRows()
    db.syncTracker.setEnabled(true)
    // Three days on: the plan rolls forward, so plan tasks, the goal and its courses change.
    const summary = await rebalanceGoal(WGU_GOAL_ID, { now: NOW + 3 * DAY, reason: 'edit' })
    expect(summary?.changed).toBe(true)
    const after = await syncedRows()
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
      (k) => before.get(k) !== after.get(k),
    )
    expect(changed.length).toBeGreaterThan(10)
    const queued = await outbox()
    expect(queued.filter((k) => !changed.includes(k))).toEqual([])
    expect(changed.filter((k) => !queued.includes(k))).toEqual([])
  })

  it('an edit in another tab during a push gets a stamp past the entry being pushed', async () => {
    const name = `forge-tracking-tabs-${Math.random().toString(36).slice(2)}`
    // Two tabs on one database, their clocks on the same millisecond, the same remote stamp seen.
    const tabA = new ForgeDB(name, () => 1_000)
    const tabB = new ForgeDB(name, () => 1_000)
    for (const tab of [tabA, tabB]) {
      // Opened first: opening loads the flag from `syncState` (none here, so off).
      await tab.open()
      tab.syncTracker.setEnabled(true)
      tab.syncTracker.seed({ maxSeenStamp: 5_000 })
    }
    await tabA.rewards.put(reward('x'))
    const pushed = (await tabA.syncOutbox.get(['rewards', 'x']))?.at
    expect(pushed).toBe(5_001)
    await tabB.rewards.update('x', { price: 1 })
    const queued = (await tabB.syncOutbox.get(['rewards', 'x']))?.at ?? 0
    expect(queued).toBeGreaterThan(pushed ?? Infinity)
    // …and tab B's next stamps stay past it.
    expect(tabB.syncTracker.stamp()).toBeGreaterThan(queued)
    tabA.close()
    tabB.close()
    await Dexie.delete(name)
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

  it('ignores a stamp that is not a finite number, from any source', async () => {
    const name = `forge-tracking-nan-${Math.random().toString(36).slice(2)}`
    const tab = new ForgeDB(name, () => 1_000)
    await tab.open()
    tab.syncTracker.setEnabled(true)
    tab.syncTracker.seed({ maxSeenStamp: 5_000 })
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      tab.syncTracker.observeRemoteStamp(bad)
      tab.syncTracker.seed({ maxSeenStamp: bad, lastStamp: bad })
    }
    expect(tab.syncTracker.stamp()).toBe(5_001)
    // A tracked write after them still queues a real stamp.
    await tab.rewards.put(reward('a'))
    expect((await tab.syncOutbox.get(['rewards', 'a']))?.at).toBe(5_002)
    // A corrupt stamp floor in the database is ignored on open too.
    await tab.table('syncState').put({ id: 'device', enabled: true, maxSeenStamp: Number.NaN })
    tab.close()
    await tab.open()
    expect(tab.syncTracker.stamp()).toBe(5_003)
    tab.close()
    await Dexie.delete(name)
  })

  it('entries carry strictly increasing stamps, even from a frozen clock', async () => {
    const name = `forge-tracking-order-${Math.random().toString(36).slice(2)}`
    const frozen = new ForgeDB(name, () => 2_000)
    await frozen.open()
    frozen.syncTracker.setEnabled(true)
    await frozen.rewards.put(reward('a'))
    await frozen.rewards.put(reward('b'))
    await frozen.rewards.bulkPut([reward('c'), reward('d')])
    const ats = (await frozen.syncOutbox.orderBy('at').toArray()).map((e) => `${e.id}@${e.at}`)
    // One stamp per write; the rows of one bulk write share it.
    expect(ats).toEqual(['a@2000', 'b@2001', 'c@2002', 'd@2002'])
    frozen.close()
    await Dexie.delete(name)
  })

  it('a remote stamp applied in one tab lifts the stamps of the other tabs', async () => {
    const leader = new ForgeDB(
      `forge-tracking-leader-${Math.random().toString(36).slice(2)}`,
      () => 1_000,
    )
    const other = new ForgeDB(
      `forge-tracking-other-${Math.random().toString(36).slice(2)}`,
      () => 1_000,
    )
    leader.syncTracker.listen()
    other.syncTracker.listen()
    try {
      leader.syncTracker.observeRemoteStamp(8_000)
      expect(leader.syncTracker.stamp()).toBe(8_001)
      // Polled, not slept (a shared machine). Each poll takes a stamp, but polls stay far below 8 000.
      await vi.waitFor(() => expect(other.syncTracker.stamp()).toBe(8_001))
      // Tracking switched in one tab follows in the other.
      leader.syncTracker.setEnabled(true, { broadcast: true })
      await vi.waitFor(() => expect(other.syncTracker.enabled).toBe(true))
      // Unrelated or malformed messages are ignored, a non-finite stamp included. The last message is a
      // sentinel: one channel delivers in order, so once it has landed the others have too.
      const stranger = new BroadcastChannel('forge:sync')
      stranger.postMessage({ type: 'tracking', on: 'yes' })
      stranger.postMessage({ type: 'syncNow' })
      stranger.postMessage({ type: 'seen', stamp: Number.NaN })
      stranger.postMessage({ type: 'seen', stamp: Number.POSITIVE_INFINITY })
      stranger.postMessage({ type: 'seen', stamp: 9_000 })
      await vi.waitFor(() => expect(other.syncTracker.stamp()).toBe(9_001))
      stranger.close()
      expect(other.syncTracker.enabled).toBe(true)
      expect(other.syncTracker.stamp()).toBe(9_002)
    } finally {
      leader.syncTracker.unlisten()
      other.syncTracker.unlisten()
      leader.close()
      other.close()
    }
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
