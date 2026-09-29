import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ForgeDB, db } from '@/db/db'
import { DB_NAME, SCHEMA_VERSION, STORES_V1, TABLE_NAMES } from '@/db/schema'
import type { Reward, Task } from '@/db/types'

let clockNow = 1_000
const clock = () => clockNow
let testDb: ForgeDB
let dbSeq = 0

beforeEach(async () => {
  clockNow = 1_000
  testDb = new ForgeDB(`forge-test-${++dbSeq}`, clock)
  await testDb.open()
})

afterEach(async () => {
  await testDb.delete()
})

const reward = (
  over: Partial<Reward> = {},
): Omit<Reward, 'createdAt' | 'updatedAt'> & Partial<Reward> => ({
  id: 'r1',
  title: '30 min gaming',
  icon: '🎮',
  price: 300,
  description: '',
  archived: false,
  order: 1,
  ...over,
})

describe('schema v1', () => {
  it('opens every table at version 1 with the planned primary key and indexes', async () => {
    expect(SCHEMA_VERSION).toBe(1)
    expect(TABLE_NAMES).toHaveLength(26)
    expect(testDb.verno).toBe(1)
    expect(testDb.tables.map((t) => t.name).sort()).toEqual([...TABLE_NAMES].sort())
    for (const name of TABLE_NAMES) {
      const table = testDb.table(name)
      expect(table.schema.primKey.keyPath).toBe('id')
      expect(await table.count()).toBe(0)
      const declared = STORES_V1[name]
        .split(',')
        .slice(1)
        .map((s) => s.trim().replace(/^\*/, ''))
      expect(table.schema.indexes.map((i) => i.name).sort()).toEqual(declared.sort())
    }
  })

  it('opens the real IndexedDB with the same shape (native check, no Dexie)', async () => {
    const stores = await new Promise<string[]>((resolve, reject) => {
      const req = indexedDB.open(testDb.name)
      req.onsuccess = () => {
        const names = Array.from(req.result.objectStoreNames)
        req.result.close()
        resolve(names)
      }
      req.onerror = () => reject(req.error)
    })
    expect(stores.sort()).toEqual([...TABLE_NAMES].sort())
  })

  it('uses the app database name for the singleton', () => {
    expect(db.name).toBe(DB_NAME)
    expect(db.verno).toBe(1)
  })

  it('supports the compound and multi-entry indexes repos rely on', async () => {
    const base = {
      notes: [],
      priority: 0,
      dueTime: null,
      estimatePomodoros: null,
      estimateMinutes: null,
      goalId: 'g1',
      milestoneId: null,
      unitId: null,
      source: 'user',
      scheduleKey: null,
      schedulePinned: false,
      skippedOn: null,
      orderInDay: 0,
      subtasks: [],
      recurrence: null,
      seriesId: null,
      order: 0,
      boardOrder: 0,
      startedAt: null,
      completedAt: null,
      completedDay: null,
    } satisfies Partial<Task>
    await testDb.tasks.bulkAdd([
      {
        ...base,
        id: 't1',
        title: 'Read ch. 4',
        status: 'todo',
        dueDate: '2026-09-29',
        tags: ['C182'],
      },
      { ...base, id: 't2', title: 'Quiz', status: 'todo', dueDate: null, tags: ['C182', 'quiz'] },
      { ...base, id: 't3', title: 'Done', status: 'done', dueDate: '2026-09-28', tags: [] },
    ])
    expect(await testDb.tasks.where('tags').equals('C182').primaryKeys()).toEqual(['t1', 't2'])
    expect(
      await testDb.tasks
        .where('[status+dueDate]')
        .between(['todo', Dexie.minKey], ['todo', Dexie.maxKey])
        .primaryKeys(),
    ).toEqual(['t1']) // null dueDate drops out of the index
    expect(
      await testDb.tasks.where('[goalId+status]').equals(['g1', 'done']).primaryKeys(),
    ).toEqual(['t3'])
  })
})

describe('timestamp stamping hooks', () => {
  it('sets createdAt and updatedAt on add', async () => {
    clockNow = 5_000
    await testDb.rewards.add(reward())
    const row = await testDb.rewards.get('r1')
    expect(row?.createdAt).toBe(5_000)
    expect(row?.updatedAt).toBe(5_000)
  })

  it('keeps timestamps supplied by the caller (restore, trash-restore)', async () => {
    await testDb.rewards.bulkPut([reward({ createdAt: 10, updatedAt: 20 })])
    const row = await testDb.rewards.get('r1')
    expect([row?.createdAt, row?.updatedAt]).toEqual([10, 20])
  })

  it('preserves createdAt and bumps updatedAt on update()', async () => {
    clockNow = 1_000
    await testDb.rewards.add(reward())
    clockNow = 2_000
    await testDb.rewards.update('r1', { price: 350 })
    const row = await testDb.rewards.get('r1')
    expect(row).toMatchObject({ price: 350, createdAt: 1_000, updatedAt: 2_000 })
  })

  it('preserves createdAt and bumps updatedAt on put() of an existing row', async () => {
    clockNow = 1_000
    await testDb.rewards.add(reward())
    const stored = await testDb.rewards.get('r1')
    if (!stored) throw new Error('missing row')
    clockNow = 3_000
    await testDb.rewards.put({ ...stored, title: 'Takeout' })
    expect(await testDb.rewards.get('r1')).toMatchObject({
      title: 'Takeout',
      createdAt: 1_000,
      updatedAt: 3_000,
    })

    // A put() that omits the timestamps entirely still keeps the stored createdAt.
    clockNow = 4_000
    const { createdAt: _c, updatedAt: _u, ...bare } = stored
    await testDb.rewards.put({ ...bare, title: 'Movie night' })
    expect(await testDb.rewards.get('r1')).toMatchObject({
      title: 'Movie night',
      createdAt: 1_000,
      updatedAt: 4_000,
    })
  })

  it('respects an explicit updatedAt in the change (sync / import)', async () => {
    await testDb.rewards.add(reward())
    clockNow = 9_000
    await testDb.rewards.update('r1', { price: 1, updatedAt: 7_777 })
    expect((await testDb.rewards.get('r1'))?.updatedAt).toBe(7_777)
  })

  it('stamps via modify() on collections', async () => {
    await testDb.rewards.bulkAdd([reward({ id: 'a' }), reward({ id: 'b' })])
    clockNow = 6_000
    await testDb.rewards.where('order').equals(1).modify({ archived: true })
    const rows = await testDb.rewards.toArray()
    expect(rows.map((r) => [r.archived, r.createdAt, r.updatedAt])).toEqual([
      [true, 1_000, 6_000],
      [true, 1_000, 6_000],
    ])
  })
})
