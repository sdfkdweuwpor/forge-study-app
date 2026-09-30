/**
 * The sync repo engine (PLAN §4.7.5, §4.7.8): a fake Supabase (`FakeSyncServer` over `SyncServerModel`)
 * and several devices simulated in one database (`Devices`: every table, the outbox and `syncState`
 * saved and loaded per device, each with its own stamp clock and wall clock).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applySeed } from '@/dev/seed'
import { db } from '@/db/db'
import { defaultSyncState } from '@/db/defaults'
import { onDomainEvent, resetDomainEvents, settleDomainEvents, type DomainEvent } from '@/db/events'
import { exportBackup, importBackup, resetAllData } from '@/db/repos/backup'
import { awardDailyGoal } from '@/db/repos/dailyGoal'
import { rebalanceGoal } from '@/db/repos/goals'
import { createPdfResource, deleteResource } from '@/db/repos/resources'
import { ensureSettings, updateSettings } from '@/db/repos/settings'
import { finishSession, startSession } from '@/db/repos/sessions'
import {
  getSyncSession,
  getSyncState,
  markSignedOut,
  pendingChangeCount,
  pendingPushRows,
  resetSyncEngineForTests,
  runSyncCycle,
  saveSession,
  saveSyncConfig,
  startSync,
  stopSync,
  type SyncCycleOptions,
  type SyncCycleResult,
} from '@/db/repos/sync'
import { healDuplicatePlanTasks } from '@/db/repos/syncHeal'
import { resetStartupSync, settleStartupSync, waitForStartupSync } from '@/db/repos/syncGate'
import { createTask, updateTask } from '@/db/repos/tasks'
import { purgeTrashItem, restoreTrashItem } from '@/db/repos/trash'
import type { SyncSession, Task } from '@/db/types'
import { SyncTransportError, type PushRow } from '@/logic/sync'
import { SYNC_TABLES, syncedSettings } from '@/logic/syncTables'
import { decideLevelCelebration } from '@/logic/xp'
import { cpuNow } from '@/test/timing'
import { Devices } from '@/test/devices'
import {
  FakeSyncServer,
  TEST_USER_ID,
  offlineError,
  serverError,
  signedOutError,
} from '@/test/fakeSyncServer'

let devices: Devices
let cloud: FakeSyncServer

const session = (over: Partial<SyncSession> = {}): SyncSession => ({
  accessToken: 'test-access',
  refreshToken: 'test-refresh',
  expiresAt: Date.now() + 60 * 60_000,
  userId: TEST_USER_ID,
  email: 'ana@example.com',
  ...over,
})

/** Turns sync on for the device in the database. */
const enable = (over: Partial<SyncSession> = {}) => startSync(session(over))

/** One cycle on the current device, with its own wall clock and no pauses. */
const cycle = (
  opts: SyncCycleOptions = {},
  server: FakeSyncServer = cloud,
): Promise<SyncCycleResult> =>
  runSyncCycle(server, {
    now: () => devices.now(),
    yieldNow: async () => undefined,
    appVersion: 'test',
    ...opts,
  })

async function syncOk(opts: SyncCycleOptions = {}) {
  const result = await cycle(opts)
  if (result.status !== 'ok') throw new Error(`cycle did not finish: ${JSON.stringify(result)}`)
  return result
}

async function syncError(opts: SyncCycleOptions = {}) {
  const result = await cycle(opts)
  if (result.status !== 'error') throw new Error(`cycle did not fail: ${JSON.stringify(result)}`)
  return result
}

const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
      : value,
  )

/**
 * Every synced row of this device as `table:id` → canonical JSON. The settings row loses its device-only
 * fields, and `lastCelebratedLevel`, which a device that pulled XP raises on its own by design.
 */
async function view(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const name of SYNC_TABLES) {
    for (const row of (await db.table(name).toArray()) as { id: string }[]) {
      const shown =
        name === 'settings' ? { ...syncedSettings(row), lastCelebratedLevel: 0 } : row
      out[`${name}:${row.id}`] = canon(shown)
    }
  }
  return out
}

const titles = async (): Promise<string[]> =>
  (await db.tasks.toArray()).map((t) => t.title).sort()

/**
 * Device A runs `setup` and syncs; device B (empty, with its default settings) syncs; the database ends
 * on device A. Both are in steady state afterwards.
 */
async function twoSyncedDevices(setup: () => Promise<void>): Promise<void> {
  await setup()
  await enable()
  await syncOk()
  await devices.switchTo('B')
  await ensureSettings()
  await enable()
  await syncOk()
  await devices.switchTo('A')
}

const steady = async (): Promise<void> => {
  const state = await getSyncState()
  expect(state?.phase).toBe('steady')
}

beforeEach(async () => {
  resetDomainEvents()
  resetStartupSync()
  resetSyncEngineForTests()
  devices = await Devices.create('A')
  await devices.reset('A')
  cloud = new FakeSyncServer()
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
  vi.useRealTimers()
})

// ─── First sync ─────────────────────────────────────────────────────────────

describe('first sync', () => {
  it('into an empty device brings everything and pushes nothing', async () => {
    await applySeed('wgu')
    await settleDomainEvents()
    await enable()
    const first = await syncOk()
    expect(first.mode).toBe('bootstrap')
    expect(first.pushed).toBeGreaterThan(50)
    expect(await pendingChangeCount()).toBe(0)
    await steady()
    const onA = await view()
    const cloudSeq = cloud.model.lastSeq

    await devices.switchTo('B')
    await ensureSettings()
    await enable()
    const second = await syncOk()
    expect(second.mode).toBe('bootstrap')
    expect(second.pushed).toBe(0)
    expect(cloud.model.lastSeq).toBe(cloudSeq)
    expect(await view()).toEqual(onA)
    expect(await pendingChangeCount()).toBe(0)
    await steady()
  })

  it('of two devices with data merges them: nothing is lost, the newer row wins, settings are adopted, a snapshot is taken', async () => {
    // A: the WGU sample, a name in settings, and a task B also has (an older copy there).
    await applySeed('wgu')
    await updateSettings({ profile: { name: 'Ana' }, dailyGoalPomodoros: 4 })
    const shared = await createTask({ title: 'Review C779 CSS notes' })
    await enable()
    await syncOk()
    const aTitles = await titles()

    // B: its own data, written before sync existed: a task of its own, and an older edit of the shared one.
    await devices.switchTo('B')
    await ensureSettings()
    await db.tasks.put({ ...shared, title: 'C779 CSS notes (older)', updatedAt: shared.updatedAt - 60_000 })
    const own = await createTask({ title: 'Email the D278 course mentor' })
    await enable()
    const b = await syncOk()
    expect(b.mode).toBe('bootstrap')
    // The account's newer row won, and B's own task was kept and pushed.
    expect((await db.tasks.get(shared.id))?.title).toBe('Review C779 CSS notes')
    expect(await db.tasks.get(own.id)).toBeDefined()
    expect(b.pushed).toBe(1)
    expect((await db.settings.get('app'))?.profile.name).toBe('Ana')
    expect((await db.settings.get('app'))?.dailyGoalPomodoros).toBe(4)
    // B had data, so a pre-sync snapshot of it was taken first.
    const snaps = await db.snapshots.where('reason').equals('pre-sync').toArray()
    expect(snaps).toHaveLength(1)
    expect(snaps[0]?.counts?.tasks).toBe(1)
    await steady()

    await devices.switchTo('A')
    await syncOk()
    expect(await titles()).toEqual([...aTitles, 'Email the D278 course mentor'].sort())
  })

  it('drops the seed rows the account already has, without tombstones', async () => {
    // A is the established device: it onboarded, so it has the starter task; its blocklist has a custom id.
    await applySeed('empty')
    const starter = await createTask({ title: 'Add your first course', source: 'onboarding' })
    await db.blocklist.put({
      id: 'block-a',
      createdAt: 1,
      updatedAt: 1,
      kind: 'domain',
      domain: 'reddit.com',
      pattern: null,
      enabled: true,
    } as never)
    await enable()
    await syncOk()

    // B seeded the same things under other ids, and has not touched them.
    await devices.switchTo('B')
    await ensureSettings()
    await db.tasks.put({ ...starter, id: 'starter-b', createdAt: 5, updatedAt: 5 })
    await db.blocklist.put({
      id: 'block-b',
      createdAt: 1,
      updatedAt: 1,
      kind: 'domain',
      domain: 'reddit.com',
      pattern: null,
      enabled: true,
    } as never)
    await enable()
    await syncOk()
    expect(await db.tasks.get('starter-b')).toBeUndefined()
    expect(await db.blocklist.get('block-b')).toBeUndefined()
    expect(await db.tasks.get(starter.id)).toBeDefined()
    // They left without a trace: no tombstone reached the cloud for them.
    expect(cloud.row('tasks', 'starter-b')).toBeUndefined()
    expect(cloud.row('blocklist', 'block-b')).toBeUndefined()
  })

  it('starts again after an interruption without a second snapshot, and ends in the same place', async () => {
    await applySeed('wgu')
    await enable()
    cloud.failNext(1, offlineError(), 'push')
    const failed = await syncError()
    expect(failed.error.kind).toBe('offline')
    expect((await getSyncState())?.phase).toBe('bootstrap')
    const snapsBefore = await db.snapshots.where('reason').equals('pre-sync').count()
    expect(snapsBefore).toBe(1)
    expect(await pendingChangeCount()).toBeGreaterThan(50)

    const again = await syncOk()
    expect(again.mode).toBe('bootstrap')
    await steady()
    expect(await db.snapshots.where('reason').equals('pre-sync').count()).toBe(1)
    expect(await pendingChangeCount()).toBe(0)
    expect(cloud.rows().length).toBeGreaterThan(50)
  })

  it('a pre-sync snapshot that cannot be written stops the first sync: nothing is pulled or pushed', async () => {
    await applySeed('wgu')
    await enable()
    const spy = vi.spyOn(db.snapshots, 'add').mockRejectedValueOnce(new Error('quota'))
    const failed = await syncError()
    expect(failed.error.kind).toBe('snapshot')
    expect(cloud.calls.filter((c) => c.op !== 'serverTime')).toHaveLength(0)
    expect((await getSyncState())?.lastError?.kind).toBe('snapshot')
    spy.mockRestore()
    await syncOk()
    await steady()
  })

  it('does not queue rows the account already has, even after a restart', async () => {
    await applySeed('wgu')
    await enable()
    await syncOk()
    await devices.switchTo('B')
    await ensureSettings()
    await enable()
    await syncOk()
    // B's first sync again (as after "sign out, sign in to the same account"): nothing is re-sent.
    await stopSync()
    await enable()
    const sent = cloud.model.lastSeq
    const again = await syncOk()
    expect(again.pushed).toBe(0)
    expect(cloud.model.lastSeq).toBe(sent)
  })
})

// ─── Steady state ───────────────────────────────────────────────────────────

describe('steady sync', () => {
  it('carries adds, edits and deletes both ways, and leaves the outbox empty', async () => {
    let id = ''
    await twoSyncedDevices(async () => {
      id = (await createTask({ title: 'Read C182 unit 3' })).id
    })
    await createTask({ title: 'Submit the D278 paper' })
    await updateTask(id, { title: 'Read C182 unit 3 (twice)' })
    expect(await pendingChangeCount()).toBe(2)
    const sent = await syncOk()
    expect(sent.mode).toBe('steady')
    expect(sent.pushed).toBe(2)
    expect(await pendingChangeCount()).toBe(0)

    await devices.switchTo('B')
    const got = await syncOk()
    expect(got.applied).toBe(2)
    expect(await titles()).toEqual(['Read C182 unit 3 (twice)', 'Submit the D278 paper'])
    // What B applied was not queued, and its own echo is not applied again.
    expect(await pendingChangeCount()).toBe(0)

    await db.tasks.delete(id)
    await syncOk()
    await devices.switchTo('A')
    await syncOk()
    expect(await titles()).toEqual(['Submit the D278 paper'])
    expect(cloud.row('tasks', id)?.deleted).toBe(true)
    expect(cloud.row('tasks', id)?.data).toBeNull()
  })

  it.each([['B'], ['A']])(
    'a concurrent edit: the device whose clock is later (%s) wins on both',
    async (winner) => {
      devices.add('B', winner === 'B' ? 10_000 : 0)
      devices.setOffset('A', winner === 'A' ? 10_000 : 0)
      let id = ''
      await twoSyncedDevices(async () => {
        id = (await createTask({ title: 'Read C182 unit 3' })).id
      })
      await updateTask(id, { title: 'Read C182 unit 3 twice' })
      await devices.switchTo('B')
      await updateTask(id, { title: 'Read C182 units 3 and 4' })
      const expected = winner === 'B' ? 'Read C182 units 3 and 4' : 'Read C182 unit 3 twice'

      await syncOk() // B first
      await devices.switchTo('A')
      await syncOk()
      expect((await db.tasks.get(id))?.title).toBe(expected)
      await devices.switchTo('B')
      await syncOk()
      expect((await db.tasks.get(id))?.title).toBe(expected)
      expect(cloud.row('tasks', id)?.data).toMatchObject({ title: expected })
      expect(await pendingChangeCount()).toBe(0)
    },
  )

  it('an edit made after seeing another device change beats it even when this clock is behind', async () => {
    devices.add('B', -10 * 60_000) // B's clock is ten minutes behind
    let id = ''
    await twoSyncedDevices(async () => {
      id = (await createTask({ title: 'Read C182 unit 3' })).id
    })
    await updateTask(id, { title: 'Read C182 unit 3, A' })
    await syncOk()
    await devices.switchTo('B')
    await syncOk() // B sees A's edit, so its clock now knows the stamp
    await updateTask(id, { title: 'Read C182 unit 3, B' })
    await syncOk()
    await devices.switchTo('A')
    await syncOk()
    expect((await db.tasks.get(id))?.title).toBe('Read C182 unit 3, B')
  })

  it('edit against delete: the later one wins, in both orders', async () => {
    devices.add('B', 0)
    let keep = ''
    let gone = ''
    await twoSyncedDevices(async () => {
      keep = (await createTask({ title: 'Edited after the delete' })).id
      gone = (await createTask({ title: 'Deleted after the edit' })).id
    })
    // A deletes `keep` first; B edits it later (an edit after a delete: it comes back).
    await db.tasks.delete(keep)
    // B edits `gone` first; A deletes it later (a delete after an edit: it stays deleted).
    await devices.switchTo('B')
    await updateTask(gone, { title: 'Deleted after the edit (edited)' })
    await new Promise((r) => setTimeout(r, 5))
    await updateTask(keep, { title: 'Edited after the delete (edited)' })
    await devices.switchTo('A')
    await new Promise((r) => setTimeout(r, 5))
    await db.tasks.delete(gone)

    await syncOk() // A: tombstones for both
    await devices.switchTo('B')
    await syncOk() // B: its edits are older than A's delete of `gone` and newer than A's delete of `keep`
    await devices.switchTo('A')
    await syncOk()
    for (const name of ['A', 'B']) {
      await devices.switchTo(name)
      await syncOk()
      expect(await db.tasks.get(keep)).toBeDefined()
      expect(await db.tasks.get(gone)).toBeUndefined()
    }
  })
})
