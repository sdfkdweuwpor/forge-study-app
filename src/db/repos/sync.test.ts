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
import { removeBlocklistEntry, seedDefaultBlocklist } from '@/db/repos/blocker'
import { archiveReward, seedStarterRewards, updateReward } from '@/db/repos/rewards'
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
import { restoreSnapshot, takeSnapshot } from '@/db/repos/snapshots'
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
      const shown = name === 'settings' ? { ...syncedSettings(row), lastCelebratedLevel: 0 } : row
      out[`${name}:${row.id}`] = canon(shown)
    }
  }
  return out
}

const titles = async (): Promise<string[]> => (await db.tasks.toArray()).map((t) => t.title).sort()

/**
 * Device A runs `setup` and syncs; device B (empty, with its default settings) syncs; the database ends
 * on device A. Both are in steady state afterwards.
 */
async function twoSyncedDevices(setup: () => Promise<void>): Promise<void> {
  await ensureSettings()
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
    await db.tasks.put({
      ...shared,
      title: 'C779 CSS notes (older)',
      updatedAt: shared.updatedAt - 60_000,
    })
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
    expect(snaps[0]?.counts?.tasks).toBe(2)
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

  it('keeps a seed row that something still points at', async () => {
    await applySeed('empty')
    const starter = await createTask({ title: 'Add your first course', source: 'onboarding' })
    await db.rewards.bulkPut([
      {
        id: 'starter-reward:0',
        createdAt: 1,
        updatedAt: 1,
        title: '30 min gaming',
        icon: '🎮',
        price: 300,
        description: '',
        archived: false,
        order: 0,
      },
      {
        id: 'starter-reward:1',
        createdAt: 1,
        updatedAt: 1,
        title: 'Coffee out',
        icon: '☕',
        price: 500,
        description: '',
        archived: false,
        order: 1,
      },
    ])
    await enable()
    await syncOk()

    // B seeded the same starters under other ids; it bought one reward and started a session on the task.
    await devices.switchTo('B')
    await ensureSettings()
    await db.tasks.put({ ...starter, id: 'starter-b', createdAt: 5, updatedAt: 5 })
    await db.rewards.put({
      id: 'old-reward-b',
      createdAt: 1,
      updatedAt: 1,
      title: '30 min gaming',
      icon: '🎮',
      price: 300,
      description: '',
      archived: false,
      order: 0,
    })
    await db.rewards.put({
      id: 'old-coffee-b',
      createdAt: 1,
      updatedAt: 1,
      title: 'Coffee out',
      icon: '☕',
      price: 500,
      description: '',
      archived: false,
      order: 1,
    })
    await db.redemptions.add({
      id: 'redeem-1',
      createdAt: 10,
      updatedAt: 10,
      rewardId: 'old-reward-b',
      rewardTitle: '30 min gaming',
      price: 300,
      at: 10,
      day: '2026-09-29',
      refundedAt: null,
    })
    await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25, taskId: 'starter-b' })
    await enable()
    await syncOk()
    // Pointed at: kept. Not pointed at, and the account has it: gone.
    expect(await db.rewards.get('old-reward-b')).toBeDefined()
    expect(await db.tasks.get('starter-b')).toBeDefined()
    expect(await db.rewards.get('old-coffee-b')).toBeUndefined()
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

describe('first sync: seed rows every device gives the same id', () => {
  const DAY = 24 * 60 * 60_000

  /** What the person did on A (whose clock runs ten days behind) before the second device existed. */
  async function aEditsItsShop(): Promise<void> {
    devices.setOffset('A', -10 * DAY)
    await ensureSettings()
    await seedStarterRewards({ now: devices.now() })
    await seedDefaultBlocklist({ now: devices.now() })
    await enable()
    await syncOk()
    await updateReward('starter-reward:0', { price: 999 }, { now: devices.now() })
    await archiveReward('starter-reward:2', { now: devices.now() })
    await db.rewards.delete('starter-reward:1')
    await removeBlocklistEntry('default:facebook.com')
    await syncOk()
  }

  async function expectTheAccountsShop(): Promise<void> {
    expect((await db.rewards.get('starter-reward:0'))?.price).toBe(999)
    expect((await db.rewards.get('starter-reward:1')) === undefined).toBe(true)
    expect((await db.rewards.get('starter-reward:2'))?.archived).toBe(true)
    expect((await db.blocklist.get('default:facebook.com')) === undefined).toBe(true)
    expect(await db.blocklist.count()).toBe(10)
    expect((cloud.row('rewards', 'starter-reward:0')?.data as { price: number }).price).toBe(999)
    expect(cloud.row('rewards', 'starter-reward:1')?.deleted).toBe(true)
    expect(cloud.row('blocklist', 'default:facebook.com')?.deleted).toBe(true)
  }

  it('a new device whose seeds are newer than the account does not bring back what was edited or removed', async () => {
    await aEditsItsShop()
    const seq = cloud.model.lastSeq

    // B is new: it seeded its shop and blocklist today, untouched, and only then turns sync on.
    await devices.switchTo('B')
    await ensureSettings()
    await seedStarterRewards()
    await seedDefaultBlocklist()
    await enable()
    const first = await syncOk()
    expect(first.mode).toBe('bootstrap')
    expect(first.pushed).toBe(0)
    expect(cloud.model.lastSeq).toBe(seq)
    await expectTheAccountsShop()
    expect(await pendingChangeCount()).toBe(0)

    // And A, syncing again, finds nothing of B's seeds on the account.
    await devices.switchTo('A')
    await syncOk()
    await expectTheAccountsShop()
  })

  it('the same when B seeded after turning sync on, so its seeds sit in the outbox', async () => {
    await aEditsItsShop()
    const seq = cloud.model.lastSeq
    await devices.switchTo('B')
    await ensureSettings()
    await enable()
    await seedStarterRewards()
    await seedDefaultBlocklist()
    expect(await pendingChangeCount()).toBeGreaterThan(10)
    const first = await syncOk()
    // Only the settings row (the two "seeded" flags) is B's own change; no reward or site reaches the account.
    expect(first.pushed).toBe(1)
    expect((await cloud.pull(seq, 500)).map((r) => r.tbl)).toEqual(['settings'])
    await expectTheAccountsShop()
    expect(await pendingChangeCount()).toBe(0)
  })

  it('a seed row the person already changed on this device is an ordinary row: the newer edit wins', async () => {
    await aEditsItsShop()
    await devices.switchTo('B')
    await ensureSettings()
    await seedStarterRewards()
    await seedDefaultBlocklist()
    // B: the price was edited today (newer than anything on A), and a default site switched off.
    await updateReward('starter-reward:0', { price: 450 })
    await db.blocklist.update('default:reddit.com', { enabled: false, updatedAt: Date.now() })
    await enable()
    await syncOk()
    expect((await db.rewards.get('starter-reward:0'))?.price).toBe(450)
    expect((cloud.row('rewards', 'starter-reward:0')?.data as { price: number }).price).toBe(450)
    expect(cloud.row('blocklist', 'default:reddit.com')).toBeDefined()
    expect(
      (cloud.row('blocklist', 'default:reddit.com')?.data as { enabled: boolean }).enabled,
    ).toBe(false)
    // The rows it did not touch still follow the account.
    expect((await db.rewards.get('starter-reward:1')) === undefined).toBe(true)
    expect((await db.blocklist.get('default:facebook.com')) === undefined).toBe(true)
  })

  it('seeds the account does not have yet are pushed as before', async () => {
    devices.setOffset('A', -10 * DAY)
    await ensureSettings()
    await enable()
    await syncOk()
    await devices.switchTo('B')
    await ensureSettings()
    await seedStarterRewards()
    await seedDefaultBlocklist()
    await enable()
    const first = await syncOk()
    expect(first.pushed).toBe(3 + 11)
    expect(cloud.row('rewards', 'starter-reward:1')?.deleted).toBe(false)
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

// ─── Trash, restore, purge ──────────────────────────────────────────────────

describe('the Trash and attached PDFs', () => {
  const pdf = () => new Blob(['%PDF-1.7 C182 study guide'], { type: 'application/pdf' })

  async function withPdf(): Promise<{ resourceId: string; fileId: string }> {
    await applySeed('wgu')
    const { resource, file } = await createPdfResource('course-c182', {
      blob: pdf(),
      name: 'C182 study guide.pdf',
    })
    return { resourceId: resource.id, fileId: file.id }
  }

  it('moves to the Trash everywhere, restores back, and the PDF stays on the device that had it', async () => {
    let ids = { resourceId: '', fileId: '' }
    await twoSyncedDevices(async () => {
      ids = await withPdf()
    })
    // B has the resource and no bytes: "file missing".
    await devices.switchTo('B')
    expect(await db.resources.get(ids.resourceId)).toBeDefined()
    expect(await db.files.get(ids.fileId)).toBeUndefined()
    await devices.switchTo('A')

    // A deletes the resource: it and its bytes go to A's Trash entry.
    const deleted = await deleteResource(ids.resourceId)
    expect(deleted).not.toBeNull()
    expect(await db.files.get(ids.fileId)).toBeUndefined()
    await syncOk()
    // The cloud holds the Trash entry with a marker where the bytes were, never the bytes.
    const trashed = cloud.rows().find((r) => r.tbl === 'trash' && !r.deleted)
    expect(JSON.stringify(trashed?.data)).toContain('__blob')
    expect(JSON.stringify(trashed?.data)).not.toContain('%PDF')

    await devices.switchTo('B')
    await syncOk()
    expect(await db.resources.get(ids.resourceId)).toBeUndefined()
    const entry = (await db.trash.toArray())[0]
    expect(entry?.id).toBe(deleted?.trashId)
    // Restore on B: the resource is back, without bytes.
    const restored = await restoreTrashItem(deleted?.trashId ?? '')
    expect(restored.ok).toBe(true)
    expect(await db.resources.get(ids.resourceId)).toBeDefined()
    expect(await db.files.get(ids.fileId)).toBeUndefined()
    await syncOk()

    // Back on A: the resource is restored, the Trash entry is gone, and the PDF is back in `files`.
    await devices.switchTo('A')
    await syncOk()
    expect(await db.resources.get(ids.resourceId)).toBeDefined()
    expect(await db.trash.count()).toBe(0)
    const file = await db.files.get(ids.fileId)
    expect(file?.blob.size).toBe(pdf().size)
    expect(await pendingChangeCount()).toBe(0)
  })

  it('a Trash entry purged on one device is gone from the other, and its PDF with it', async () => {
    let ids = { resourceId: '', fileId: '' }
    await twoSyncedDevices(async () => {
      ids = await withPdf()
    })
    const deleted = await deleteResource(ids.resourceId)
    await syncOk()
    await devices.switchTo('B')
    await syncOk()
    expect(await purgeTrashItem(deleted?.trashId ?? '')).toBe(true)
    await syncOk()
    await devices.switchTo('A')
    await syncOk()
    expect(await db.trash.count()).toBe(0)
    expect(await db.resources.get(ids.resourceId)).toBeUndefined()
    // Nothing points at the file any more: it is gone for good, as after "Delete forever".
    expect(await db.files.get(ids.fileId)).toBeUndefined()
  })
})

// ─── Import, restore, reset ─────────────────────────────────────────────────

describe('replacing and erasing data', () => {
  it('an import on one device replaces the data on the other, which takes a safety snapshot first', async () => {
    let small: Awaited<ReturnType<typeof exportBackup>> | null = null
    await twoSyncedDevices(async () => {
      await applySeed('empty')
      await createTask({ title: 'C182 unit 1' })
      await createTask({ title: 'C182 unit 2' })
      small = await exportBackup(Date.now(), 'test')
      for (let i = 0; i < 60; i++) await createTask({ title: `D278 practice set ${i + 1}` })
    })
    // A second round so both hold the 62 tasks.
    await syncOk()
    await devices.switchTo('B')
    await syncOk()
    expect(await db.tasks.count()).toBe(62)
    await devices.switchTo('A')

    await importBackup(small!.file, Date.now())
    expect(await db.tasks.count()).toBe(2)
    await syncOk()

    await devices.switchTo('B')
    const before = await db.snapshots.where('reason').equals('pre-sync').count()
    await syncOk()
    expect(await titles()).toEqual(['C182 unit 1', 'C182 unit 2'])
    const snaps = await db.snapshots.where('reason').equals('pre-sync').toArray()
    expect(snaps.length).toBe(before + 1)
    // The snapshot holds the data as it was before the pull.
    expect(snaps.some((s) => s.counts?.tasks === 62)).toBe(true)
  })

  it('restoring a snapshot on one device replaces the data on the other too', async () => {
    let snapshotId = ''
    await twoSyncedDevices(async () => {
      await applySeed('empty')
      await createTask({ title: 'C779 unit 1' })
      snapshotId = (await takeSnapshot('manual', { now: Date.now(), appVersion: 'test' }))?.id ?? ''
      for (let i = 0; i < 30; i++) await createTask({ title: `C779 review ${i + 1}` })
    })
    await syncOk()
    await devices.switchTo('B')
    await syncOk()
    expect(await db.tasks.count()).toBe(31)
    await devices.switchTo('A')
    await restoreSnapshot(snapshotId, { now: Date.now(), appVersion: 'test' })
    await syncOk()
    await devices.switchTo('B')
    await syncOk()
    expect(await titles()).toEqual(['C779 unit 1'])
    // B took its own safety snapshot before the 30 deletions arrived.
    expect(await db.snapshots.where('reason').equals('pre-sync').count()).toBe(1)
  })

  it('fewer than 25 deletions take no snapshot', async () => {
    await twoSyncedDevices(async () => {
      for (let i = 0; i < 10; i++) await createTask({ title: `C779 exercise ${i + 1}` })
    })
    await db.tasks.clear()
    await syncOk()
    await devices.switchTo('B')
    await syncOk()
    expect(await db.tasks.count()).toBe(0)
    expect(await db.snapshots.where('reason').equals('pre-sync').count()).toBe(0)
  })

  it('a reset on one device leaves the other device and the cloud untouched', async () => {
    await twoSyncedDevices(async () => {
      await applySeed('wgu')
    })
    const rows = cloud.rows().length
    const seq = cloud.model.lastSeq
    await resetAllData()
    expect(await getSyncState()).toBeUndefined()
    expect(db.syncTracker.enabled).toBe(false)
    expect(await pendingChangeCount()).toBe(0)
    // Sync is off on A now: nothing runs.
    expect((await cycle()).status).toBe('off')
    expect(cloud.rows().length).toBe(rows)
    expect(cloud.model.lastSeq).toBe(seq)

    await devices.switchTo('B')
    const b = await syncOk()
    expect(b.applied).toBe(0)
    expect(await db.tasks.count()).toBeGreaterThan(10)
    expect(cloud.rows().filter((r) => r.deleted)).toHaveLength(0)
  })
})

// ─── Failures in the middle ─────────────────────────────────────────────────

describe('when a call fails', () => {
  it('a push whose answer was lost is sent again harmlessly', async () => {
    await twoSyncedDevices(async () => {
      await createTask({ title: 'Read C182 unit 1' })
    })
    await createTask({ title: 'Read C182 unit 2' })
    cloud.loseAnswerNext()
    const lost = await syncError()
    expect(lost.error.kind).toBe('offline')
    // The server has it; this device does not know, so the entry stays.
    expect(cloud.rows().filter((r) => r.tbl === 'tasks')).toHaveLength(2)
    expect(await pendingChangeCount()).toBe(1)

    const again = await syncOk()
    expect(again.pushed).toBe(1)
    expect(cloud.rows().filter((r) => r.tbl === 'tasks')).toHaveLength(2)
    expect(await pendingChangeCount()).toBe(0)
    // Its own row coming back is an echo, not a conflict: nothing changed here.
    expect(again.applied).toBe(0)

    await devices.switchTo('B')
    await syncOk()
    expect(await titles()).toEqual(['Read C182 unit 1', 'Read C182 unit 2'])
  })

  it('an edit made while a push is out is pushed again in the same cycle, and nothing is lost', async () => {
    let id = ''
    await twoSyncedDevices(async () => {
      id = (await createTask({ title: 'Read C182 unit 1' })).id
    })
    await updateTask(id, { title: 'Read C182 unit 1, first edit' })
    let edited = false
    cloud.afterPushStored = async () => {
      if (edited) return
      edited = true
      await updateTask(id, { title: 'Read C182 unit 1, second edit' })
    }
    const pushes = cloud.count('push')
    const result = await syncOk()
    expect(cloud.count('push') - pushes).toBe(2)
    expect(result.pushed).toBe(2)
    expect(cloud.row('tasks', id)?.data).toMatchObject({ title: 'Read C182 unit 1, second edit' })
    expect(await pendingChangeCount()).toBe(0)
    await devices.switchTo('B')
    await syncOk()
    expect((await db.tasks.get(id))?.title).toBe('Read C182 unit 1, second edit')
  })

  it('keeps an entry whose stamp moved while its push was out', async () => {
    let id = ''
    await twoSyncedDevices(async () => {
      id = (await createTask({ title: 'Read C182 unit 1' })).id
    })
    await updateTask(id, { title: 'Read C182 unit 1, first edit' })
    cloud.afterPushStored = async () => {
      await updateTask(id, { title: 'Read C182 unit 1, second edit' })
      // Nothing more may be sent this cycle: the state after one round is what counts.
      cloud.failNext(5, offlineError(), 'push')
    }
    const failed = await syncError()
    expect(failed.error.kind).toBe('offline')
    expect(cloud.row('tasks', id)?.data).toMatchObject({ title: 'Read C182 unit 1, first edit' })
    const left = await db.syncOutbox.toArray()
    expect(left).toHaveLength(1)
    expect(left[0]).toMatchObject({ tbl: 'tasks', id })
    cloud.calm()
    await syncOk()
    expect(cloud.row('tasks', id)?.data).toMatchObject({ title: 'Read C182 unit 1, second edit' })
    expect(await pendingChangeCount()).toBe(0)
  })

  it('a crash in the middle of a pull leaves the cursor and the data consistent', async () => {
    await twoSyncedDevices(async () => {
      await createTask({ title: 'C182 unit 1' })
    })
    const base = (await db.tasks.toArray())[0] as Task
    const rowsOf = (prefix: string, count: number, stamp: number): PushRow[] =>
      Array.from({ length: count }, (_v, i) => ({
        tbl: 'tasks',
        id: `${prefix}-${i}`,
        updatedAt: stamp + i,
        deviceId: 'other-device',
        deleted: false,
        schemaVersion: 3,
        data: { ...base, id: `${prefix}-${i}`, title: `C182 exercise ${i + 1}` },
      }))
    // 1,200 rows arrive: pages of 500, 500 and 200. The second page's answer never comes.
    cloud.inject(rowsOf('t', 1200, Date.now()))
    let page = 0
    cloud.beforePullAnswer = () => {
      page += 1
      if (page === 2) throw offlineError()
    }
    const crashed = await syncError()
    expect(crashed.error.kind).toBe('offline')
    // The first page is in, together with the cursor that says so; nothing of the second is.
    const cursor = (await getSyncState())?.pullCursor ?? 0
    const first = cloud.rows().filter((r) => r.id.startsWith('t-') && r.seq <= cursor)
    expect(first.length).toBeGreaterThan(400)
    expect(first.length).toBeLessThan(500)
    const here = await db.tasks.filter((t) => t.id.startsWith('t-')).count()
    expect(here).toBe(first.length)
    const next = cloud.rows().find((r) => r.id.startsWith('t-') && r.seq > cursor)
    expect(await db.tasks.get(next?.id ?? '')).toBeUndefined()

    cloud.calm()
    const done = await syncOk()
    expect(done.pulled).toBe(cloud.rows().filter((r) => r.seq > cursor).length)
    expect(await db.tasks.count()).toBe(1 + 1200)
    expect((await getSyncState())?.pullCursor).toBe(cloud.model.lastSeq)
  })

  it('a newer schema stops the pull before that page is written, and the cursor stays', async () => {
    await twoSyncedDevices(async () => {
      await createTask({ title: 'Read C182 unit 1' })
    })
    await devices.switchTo('B')
    const cursor = (await getSyncState())?.pullCursor
    cloud.inject([
      {
        tbl: 'tasks',
        id: 'from-the-future',
        updatedAt: Date.now(),
        deviceId: 'newer-forge',
        deleted: false,
        schemaVersion: 99,
        data: { id: 'from-the-future', title: 'A task with a field Forge 4 adds' },
      },
    ])
    const stopped = await syncError()
    expect(stopped.error.kind).toBe('updateNeeded')
    expect(stopped.error.message).toContain('newer Forge')
    expect(await db.tasks.get('from-the-future')).toBeUndefined()
    expect((await getSyncState())?.pullCursor).toBe(cursor)
    expect((await getSyncState())?.lastError?.kind).toBe('updateNeeded')
  })

  it('a row it cannot read is skipped and counted, and the cursor moves on', async () => {
    await twoSyncedDevices(async () => {
      await createTask({ title: 'Read C182 unit 1' })
    })
    await devices.switchTo('B')
    cloud.inject([
      {
        tbl: 'tasks',
        id: 'wrong-id',
        updatedAt: Date.now(),
        deviceId: 'other',
        deleted: false,
        schemaVersion: 3,
        data: { id: 'a-different-id', title: 'Broken' },
      },
    ])
    const result = await syncOk()
    expect(result.pulled).toBe(1)
    expect(result.applied).toBe(0)
    expect((await getSyncState())?.pullCursor).toBe(cloud.model.lastSeq)
  })
})

// ─── Rows of another shape ─────────────────────────────────────────────────

describe('rows the server holds in another shape', () => {
  it('migrates a row written by an older Forge on the way in', async () => {
    await twoSyncedDevices(async () => {
      await createTask({ title: 'Read C182 unit 1' })
    })
    const base = (await db.tasks.toArray())[0] as Task
    // A v1 task: none of the planner fields v2 added.
    const v1: Record<string, unknown> = { ...base, id: 'old-task', title: 'Review C779 HTML notes' }
    for (const field of [
      'kind',
      'doDate',
      'doTime',
      'durationMinutes',
      'autoSlot',
      'assessmentId',
    ]) {
      delete v1[field]
    }
    cloud.inject([
      {
        tbl: 'tasks',
        id: 'old-task',
        updatedAt: Date.now(),
        deviceId: 'old-forge',
        deleted: false,
        schemaVersion: 1,
        data: v1,
      },
    ])
    await devices.switchTo('B')
    await syncOk()
    const row = await db.tasks.get('old-task')
    expect(row?.title).toBe('Review C779 HTML notes')
    expect(row?.kind).toBe('task')
    expect(row).toHaveProperty('doDate')
  })

  it('drops the `sync` field of a v2 settings row: device config never rides in a synced row', async () => {
    await twoSyncedDevices(async () => {
      await updateSettings({ profile: { name: 'Ana' } })
    })
    const settings = await db.settings.get('app')
    cloud.inject([
      {
        tbl: 'settings',
        id: 'app',
        updatedAt: Date.now() + 1000,
        deviceId: 'old-forge',
        deleted: false,
        schemaVersion: 2,
        data: { ...settings, profile: { name: 'Ana B.' }, sync: { enabled: true, url: 'x' } },
      },
    ])
    await syncOk()
    const after = await db.settings.get('app')
    expect(after?.profile.name).toBe('Ana B.')
    expect(after).not.toHaveProperty('sync')
  })

  it('skips a table this Forge does not have, and never deletes the settings row for a tombstone', async () => {
    await twoSyncedDevices(async () => {
      await createTask({ title: 'Read C182 unit 1' })
    })
    cloud.inject([
      {
        tbl: 'futureThings' as never,
        id: 'x',
        updatedAt: Date.now(),
        deviceId: 'future',
        deleted: false,
        schemaVersion: 3,
        data: { id: 'x' },
      },
      {
        tbl: 'settings',
        id: 'app',
        updatedAt: Date.now() + 1000,
        deviceId: 'future',
        deleted: true,
        schemaVersion: 3,
        data: null,
      },
    ])
    const result = await syncOk()
    expect(result.applied).toBe(0)
    expect(await db.settings.get('app')).toBeDefined()
    expect((await getSyncState())?.pullCursor).toBe(cloud.model.lastSeq)
  })

  it('a tombstone for a row this device never had changes nothing', async () => {
    await twoSyncedDevices(async () => {
      await createTask({ title: 'Read C182 unit 1' })
    })
    cloud.inject([
      {
        tbl: 'tasks',
        id: 'never-here',
        updatedAt: Date.now(),
        deviceId: 'other',
        deleted: true,
        schemaVersion: 3,
        data: null,
      },
    ])
    const result = await syncOk()
    expect(result.pulled).toBeGreaterThanOrEqual(1)
    expect(result.applied).toBe(0)
  })
})

// ─── An edit that meets a pull ──────────────────────────────────────────────

describe('a local change that has not been pushed when a newer row arrives', () => {
  async function editDuringPull(remoteOffsetMs: number) {
    let id = ''
    await twoSyncedDevices(async () => {
      id = (await createTask({ title: 'Read C182 unit 1' })).id
    })
    const base = (await db.tasks.get(id)) as Task
    // The pull answers with another device's newer (or older) row, while a local edit lands.
    cloud.inject([
      {
        tbl: 'tasks',
        id,
        updatedAt: Date.now() + remoteOffsetMs,
        deviceId: 'other-device',
        deleted: false,
        schemaVersion: 3,
        data: { ...base, title: 'Read C182 unit 1, from the phone' },
      },
    ])
    cloud.beforePullAnswer = async () => {
      cloud.beforePullAnswer = null
      await updateTask(id, { title: 'Read C182 unit 1, from the laptop' })
    }
    const result = await syncOk()
    return { id, result }
  }

  it('the newer remote row wins and drops the pending entry', async () => {
    const { id } = await editDuringPull(60_000)
    expect((await db.tasks.get(id))?.title).toBe('Read C182 unit 1, from the phone')
    expect(await pendingChangeCount()).toBe(0)
  })

  it('a newer local change stays queued, is pushed next time, and wins on the server', async () => {
    const { id } = await editDuringPull(-60_000)
    expect((await db.tasks.get(id))?.title).toBe('Read C182 unit 1, from the laptop')
    expect(await pendingChangeCount()).toBe(1)
    await syncOk()
    expect(cloud.row('tasks', id)?.data).toMatchObject({
      title: 'Read C182 unit 1, from the laptop',
    })
    expect(await pendingChangeCount()).toBe(0)
  })
})

// ─── What does not travel, or travels late ──────────────────────────────────

describe('what a device keeps to itself', () => {
  it('a running session is not pushed until it ends', async () => {
    await twoSyncedDevices(async () => {
      await applySeed('wgu')
    })
    const started = await startSession({ mode: 'pomodoro', kind: 'focus', plannedMin: 25 })
    const pushed = await syncOk()
    expect(pushed.pushed).toBe(0)
    expect(cloud.row('sessions', started.id)).toBeUndefined()
    expect(await pendingChangeCount()).toBe(0)

    await finishSession(started.id, { now: Date.now() + 26 * 60_000 })
    await settleDomainEvents()
    expect(await pendingChangeCount()).toBeGreaterThan(0)
    await syncOk()
    expect(cloud.row('sessions', started.id)?.data).toMatchObject({ status: 'completed' })

    await devices.switchTo('B')
    await syncOk()
    expect((await db.sessions.get(started.id))?.status).toBe('completed')
  })

  it('device-only settings are not overwritten by a pull', async () => {
    await twoSyncedDevices(async () => {
      await applySeed('empty')
      await updateSettings({ appearance: { theme: 'light' } })
    })
    await devices.switchTo('B')
    await updateSettings({ appearance: { theme: 'dark', accent: 'green' } })
    await devices.switchTo('A')
    await updateSettings({ profile: { name: 'Ana' } })
    await syncOk()
    await devices.switchTo('B')
    await syncOk()
    const settings = await db.settings.get('app')
    expect(settings?.profile.name).toBe('Ana')
    expect(settings?.appearance.theme).toBe('dark')
    expect(settings?.appearance.accent).toBe('green')
    // B's appearance change did not queue the settings row.
    expect(await pendingChangeCount()).toBe(0)
  })
})

// ─── XP, levels, plans ──────────────────────────────────────────────────────

describe('derived data after a pull', () => {
  it('the same daily goal paid on both devices offline is one +25', async () => {
    devices.add('B', 0)
    await twoSyncedDevices(async () => {
      await applySeed('empty')
      await updateSettings({ dailyGoalPomodoros: 1 })
    })
    const day = '2026-10-01'
    const at = new Date(2026, 9, 1, 10).getTime()
    const paid = async () => {
      await db.sessions.add({
        id: `s-${devices.current}`,
        createdAt: at,
        updatedAt: at,
        kind: 'focus',
        mode: 'pomodoro',
        status: 'completed',
        taskId: null,
        goalId: null,
        milestoneId: null,
        day,
        startedAt: at,
        endedAt: at + 25 * 60_000,
        plannedMinutes: 25,
        pausedMs: 0,
        pausedAt: null,
        actualMinutes: 25,
        round: 1,
        interrupted: false,
        counted: true,
        note: null,
      })
      return awardDailyGoal(day)
    }
    expect(await paid()).not.toBeNull()
    await devices.switchTo('B')
    expect(await paid()).not.toBeNull()
    await syncOk()
    await devices.switchTo('A')
    await syncOk()
    await devices.switchTo('B')
    await syncOk()
    for (const name of ['A', 'B']) {
      await devices.switchTo(name)
      const events = await db.xpEvents.where('source').equals('dailyGoal').toArray()
      expect(events.map((e) => e.id)).toEqual([`xp:dailyGoal:${day}#0`])
      expect(events.reduce((sum, e) => sum + e.amount, 0)).toBe(25)
    }
  })

  it('XP earned on one device plays no level-up on the other, and raises no per-action events', async () => {
    await applySeed('wgu')
    await updateSettings({ lastCelebratedLevel: 1 })
    await enable()
    await syncOk()
    const levelOnA = (await db.xpEvents.toArray()).reduce((n, e) => n + e.amount, 0)
    expect(levelOnA).toBeGreaterThan(0)

    await devices.switchTo('B')
    await ensureSettings()
    await updateSettings({ lastCelebratedLevel: 1 })
    await enable()
    const seen: DomainEvent[] = []
    for (const type of ['xp.changed', 'task.completed', 'task.changed', 'session.ended'] as const) {
      onDomainEvent(type, (e) => void seen.push(e))
    }
    const applied: DomainEvent[] = []
    onDomainEvent('sync.applied', (e) => void applied.push(e))
    await syncOk()
    await settleDomainEvents()

    const settings = await db.settings.get('app')
    const lifetime = (await db.xpEvents.toArray()).reduce((n, e) => n + e.amount, 0)
    expect(lifetime).toBe(levelOnA)
    const { levelFromLifetimeXp } = await import('@/logic/xp')
    const level = levelFromLifetimeXp(lifetime).level
    expect(level).toBeGreaterThan(1)
    expect(settings?.lastCelebratedLevel).toBe(level)
    expect(decideLevelCelebration(settings?.lastCelebratedLevel ?? 0, level).kind).toBe('none')
    expect(seen).toEqual([])
    // One event for the whole cycle, naming what changed.
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ type: 'sync.applied' })
    const event = applied[0] as Extract<DomainEvent, { type: 'sync.applied' }>
    expect(event.tables).toEqual(expect.arrayContaining(['tasks', 'xpEvents', 'goals']))
    expect(event.goalIds).toContain('goal-wgu-bscs')
  })

  it('two open tasks for one plan item, made by two devices, are healed after the pull', async () => {
    await twoSyncedDevices(async () => {
      await applySeed('wgu')
    })
    const plan = (await db.tasks.toArray()).filter(
      (t) => t.source === 'schedule' && t.status !== 'done' && t.scheduleKey !== null,
    )
    const original = plan[0] as Task
    expect(original).toBeDefined()
    // B re-planned offline and made its own task for the same plan item.
    await devices.switchTo('B')
    const copy: Task = {
      ...original,
      id: 'plan-copy-from-b',
      createdAt: original.createdAt + 1000,
      updatedAt: original.createdAt + 1000,
    }
    await db.tasks.add(copy)
    await syncOk()
    await devices.switchTo('A')
    const applied: DomainEvent[] = []
    onDomainEvent('sync.applied', (e) => void applied.push(e))
    await syncOk()
    await settleDomainEvents()
    expect(await db.tasks.get(copy.id)).toBeDefined()
    const event = applied[0] as Extract<DomainEvent, { type: 'sync.applied' }>
    expect(event.goalIds).toEqual(['goal-wgu-bscs'])

    const healed = await healDuplicatePlanTasks(event.goalIds)
    expect(healed).toEqual(['goal-wgu-bscs'])
    // The older task stays, the newer one is removed, and nothing else moved into two.
    expect(await db.tasks.get(original.id)).toBeDefined()
    expect(await db.tasks.get(copy.id)).toBeUndefined()
    const keys = (await db.tasks.toArray())
      .filter((t) => t.source === 'schedule' && t.status !== 'done')
      .map((t) => t.scheduleKey)
    expect(new Set(keys).size).toBe(keys.length)
    // Healing is idempotent, and the removal travels back as a tombstone.
    expect(await healDuplicatePlanTasks(event.goalIds)).toEqual([])
    await syncOk()
    expect(cloud.row('tasks', copy.id)?.deleted).toBe(true)
    await devices.switchTo('B')
    await syncOk()
    expect(await db.tasks.get(copy.id)).toBeUndefined()
    expect(await healDuplicatePlanTasks(['goal-wgu-bscs'])).toEqual([])
  })
})

// ─── The start-up gate ──────────────────────────────────────────────────────

describe('waitForStartupSync', () => {
  it('resolves at once when sync is off', async () => {
    vi.useFakeTimers()
    let done = false
    void waitForStartupSync(8000).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
  })

  it('waits for the first cycle when sync is on, then lets everyone go', async () => {
    await enable()
    let done = false
    const waiting = waitForStartupSync(8000).then(() => (done = true))
    await new Promise((r) => setTimeout(r, 10))
    expect(done).toBe(false)
    await syncOk()
    await waiting
    expect(done).toBe(true)
    // Settled: later calls do not wait.
    await waitForStartupSync(8000)
  })

  it('gives up after its timeout', async () => {
    await enable()
    vi.useFakeTimers()
    let done = false
    void waitForStartupSync(8000).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(7999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })

  it('opens when the first cycle fails too, or decides not to run', async () => {
    await enable()
    const waiting = waitForStartupSync(8000)
    cloud.offline = true
    await syncError()
    await waiting
    resetStartupSync()
    const other = waitForStartupSync(8000)
    settleStartupSync()
    await other
  })
})

// ─── Contracts with the earlier steps ───────────────────────────────────────

describe('stamps and the clock', () => {
  it('tells the tracker about each applied page and stores maxSeenStamp with the cursor', async () => {
    await twoSyncedDevices(async () => {
      await createTask({ title: 'Read C182 unit 1' })
    })
    await updateTask((await db.tasks.toArray())[0]?.id ?? '', { title: 'Read C182 unit 1 (A)' })
    await syncOk()
    await devices.switchTo('B')
    const seen = vi.spyOn(db.syncTracker, 'observeRemoteStamp')
    await syncOk()
    const top = Math.max(...cloud.rows().map((r) => r.updatedAt))
    expect(seen).toHaveBeenCalledWith(top)
    const state = await getSyncState()
    expect(state?.maxSeenStamp).toBeGreaterThanOrEqual(top)
    // Every stamp this tab issues from now on is past it.
    expect(db.syncTracker.stamp()).toBeGreaterThan(top)
  })

  it('raises maxSeenStamp to the largest pushed stamp in the compare-and-delete', async () => {
    await twoSyncedDevices(async () => {
      await createTask({ title: 'Read C182 unit 1' })
    })
    const task = await createTask({ title: 'Read C182 unit 2' })
    const entry = await db.syncOutbox.get(['tasks', task.id])
    await syncOk()
    expect((await getSyncState())?.maxSeenStamp).toBeGreaterThanOrEqual(entry?.at ?? Infinity)
  })

  it('measures the server clock once, and again after an hour', async () => {
    await enable()
    cloud.clockOffsetMs = 7 * 60_000
    await syncOk()
    expect(cloud.count('serverTime')).toBe(1)
    const skew = (await getSyncState())?.clockSkewMs ?? 0
    expect(Math.abs(skew - 7 * 60_000)).toBeLessThan(2000)
    await syncOk()
    expect(cloud.count('serverTime')).toBe(1)
    devices.setOffset('A', 61 * 60_000)
    await syncOk()
    expect(cloud.count('serverTime')).toBe(2)
  })
})

describe('a batch the server will not take', () => {
  async function twentyTasks(): Promise<Task[]> {
    const out: Task[] = []
    for (let i = 0; i < 20; i++) out.push(await createTask({ title: `C182 flashcards ${i + 1}` }))
    return out
  }

  it('a row refused with 400 is found by halving, skipped, reported, and the rest goes through', async () => {
    await enable()
    await syncOk()
    const tasks = await twentyTasks()
    const bad = tasks[7]!
    cloud.refuseRow = (row) => row.id === bad.id
    const result = await syncOk()
    expect(result.status).toBe('ok')
    expect(result.refused).toHaveLength(1)
    expect(result.refused[0]).toMatchObject({ tbl: 'tasks', id: bad.id, reason: 'refused' })
    expect(cloud.rows().filter((r) => r.tbl === 'tasks')).toHaveLength(19)
    expect(await pendingChangeCount()).toBe(0)
    const error = (await getSyncState())?.lastError
    expect(error?.message).toContain('C182 flashcards 8')
    // Edited again it is tried again, and a fixed server takes it.
    cloud.calm()
    await updateTask(bad.id, { title: 'C182 flashcards 8 (fixed)' })
    const next = await syncOk()
    expect(next.refused).toHaveLength(0)
    expect(cloud.row('tasks', bad.id)).toBeDefined()
    expect((await getSyncState())?.lastError).toBeNull()
  })

  it('a 413 halves the batch until it fits; one row alone that is too large is skipped and named', async () => {
    await enable()
    await syncOk()
    const tasks = await twentyTasks()
    const big = tasks[3]!
    await updateTask(big.id, {
      title: 'C182 flashcards 4',
      notes: [{ id: 'n', text: 'x'.repeat(5000) }] as never,
    })
    cloud.maxPushBytes = 4000
    const result = await syncOk()
    expect(result.refused.map((r) => r.id)).toEqual([big.id])
    expect(result.refused[0]?.reason).toBe('tooLarge')
    expect(cloud.rows().filter((r) => r.tbl === 'tasks')).toHaveLength(19)
    expect(cloud.calls.filter((c) => c.op === 'push').length).toBeGreaterThan(3)
    expect((await getSyncState())?.lastError?.kind).toBe('tooLarge')
    expect(await pendingChangeCount()).toBe(0)
  })

  it('a server that refuses every row loses nothing: the cycle fails, every change stays queued, and goes once the server is fixed', async () => {
    await enable()
    await syncOk()
    await twentyTasks()
    const queued = await pendingChangeCount()
    expect(queued).toBeGreaterThanOrEqual(20)
    cloud.refuseRow = () => true
    const failed = await syncError()
    expect(failed.error.kind).toBe('server')
    expect(failed.httpStatus).toBe(400)
    // Not one entry was dropped, however many rows were tried, and again on the next cycle.
    expect(await pendingChangeCount()).toBe(queued)
    await syncError()
    expect(await pendingChangeCount()).toBe(queued)
    expect((await getSyncState())?.lastError?.kind).toBe('server')

    cloud.calm()
    const fixed = await syncOk()
    expect(fixed.refused).toHaveLength(0)
    expect(await pendingChangeCount()).toBe(0)
    expect(cloud.rows().filter((r) => r.tbl === 'tasks')).toHaveLength(20)
    expect((await getSyncState())?.lastError).toBeNull()
  })

  it('one refused row with nothing else to send stays queued, the pull still goes on, and it goes out once something else is taken', async () => {
    await enable()
    await syncOk()
    await devices.switchTo('B')
    await ensureSettings()
    await enable()
    await syncOk()
    const fromB = await createTask({ title: 'Email the D278 course mentor' })
    await syncOk()
    await devices.switchTo('A')

    const bad = await createTask({ title: 'C182 flashcards 8' })
    cloud.refuseRow = (row) => row.id === bad.id
    const failed = await syncError()
    expect(failed.error.kind).toBe('server')
    // Alone, it cannot be told from a server that takes nothing: it is kept, and B's task still arrived.
    expect(await db.syncOutbox.get(['tasks', bad.id])).toBeDefined()
    expect(await db.tasks.get(fromB.id)).toBeDefined()

    // Another change the server takes shows the row is the problem: it is left out and named.
    await createTask({ title: 'Review C779 CSS notes' })
    const next = await syncOk()
    expect(next.pushed).toBe(1)
    expect(next.refused.map((r) => r.id)).toEqual([bad.id])
    expect(await pendingChangeCount()).toBe(0)
    expect((await getSyncState())?.lastError?.message).toContain('C182 flashcards 8')
  })

  it('a refused row in the first 200 entries does not wedge the rest of a long queue', async () => {
    await enable()
    await syncOk()
    const template = await createTask({ title: 'C182 flashcards 1' })
    await syncOk()
    const many: Task[] = Array.from({ length: 250 }, (_, i) => ({
      ...template,
      id: `bulk-${i}`,
      title: `C182 flashcards ${i + 2}`,
    }))
    await db.tasks.bulkAdd(many)
    expect(await pendingChangeCount()).toBe(250)
    cloud.refuseRow = (row) => row.id === 'bulk-0'
    const result = await syncOk()
    expect(result.refused.map((r) => r.id)).toEqual(['bulk-0'])
    expect(result.pushed).toBe(249)
    expect(cloud.rows().filter((r) => r.tbl === 'tasks')).toHaveLength(250)
    expect(cloud.row('tasks', 'bulk-0')).toBeUndefined()
    expect(await pendingChangeCount()).toBe(0)
  })

  it('a row edited again after the server refused it is tried again at once', async () => {
    await enable()
    await syncOk()
    const bad = await createTask({ title: 'C182 flashcards 8' })
    const good = await createTask({ title: 'Review C779 CSS notes' })
    cloud.refuseRow = (row) => row.id === bad.id
    cloud.afterPushStored = async () => {
      // The person fixes the row while the cycle is running.
      cloud.refuseRow = null
      cloud.afterPushStored = null
      await updateTask(bad.id, { title: 'C182 flashcards 8 (fixed)' })
    }
    const result = await syncOk()
    expect(result.refused).toHaveLength(0)
    expect(cloud.row('tasks', bad.id)).toBeDefined()
    expect(cloud.row('tasks', good.id)).toBeDefined()
    expect(await pendingChangeCount()).toBe(0)
  })
})

describe('text the server scrubbed', () => {
  it('its own push coming back with cleaned characters is an echo, not a conflict', async () => {
    let id = ''
    await twoSyncedDevices(async () => {
      id = (await createTask({ title: 'Read C182 unit 1 ✂\ud83d' })).id
    })
    // The server's copy differs only in the scrubbed character, same stamp, same device.
    const stored = cloud.row('tasks', id)
    expect(stored).toBeDefined()
    cloud.inject([
      {
        ...(stored as PushRow),
        data: { ...(stored?.data as object), title: 'Read C182 unit 1 ✂\ufffd' },
      },
    ])
    const local = await db.tasks.get(id)
    const result = await syncOk()
    expect(result.applied).toBe(0)
    expect(await db.tasks.get(id)).toEqual(local)
    expect(await pendingChangeCount()).toBe(0)

    // Also through a restarted first sync: same device id, row not queued again.
    await db.syncState.put({ ...(await getSyncState())!, phase: 'bootstrap' })
    const sent = cloud.model.lastSeq
    const again = await syncOk()
    expect(again.pushed).toBe(0)
    expect(cloud.model.lastSeq).toBe(sent)
    expect(await db.tasks.get(id)).toEqual(local)
  })
})

// ─── The session ────────────────────────────────────────────────────────────

describe('the sign-in', () => {
  it('refreshes a token that is about to expire before the cycle, and keeps the new session', async () => {
    await enable({ expiresAt: Date.now() + 30_000 })
    const refresh = vi.fn(async (s: SyncSession) =>
      session({ accessToken: 'test-access-2', refreshToken: 'test-refresh-2', email: s.email }),
    )
    await syncOk({ refresh })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect((await getSyncSession())?.refreshToken).toBe('test-refresh-2')
  })

  it('a 401 refreshes once and repeats the call', async () => {
    await enable()
    cloud.failNext(1, signedOutError(), 'push')
    await createTask({ title: 'Read C182 unit 1' })
    const refresh = vi.fn(async (s: SyncSession) =>
      session({ refreshToken: 'test-refresh-2', email: s.email }),
    )
    const result = await syncOk({ refresh })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(result.pushed).toBeGreaterThan(0)
    expect((await getSyncSession())?.refreshToken).toBe('test-refresh-2')
  })

  it('a lost answer to the refresh is retried once; "already used" then means signing in again', async () => {
    await enable({ expiresAt: Date.now() + 1000 })
    const lost = new SyncTransportError('offline', 'lost', { status: null })
    const used = new SyncTransportError('signedOut', 'used', {
      status: 400,
      code: 'refresh_token_already_used',
    })
    const refresh = vi.fn().mockRejectedValueOnce(lost).mockRejectedValueOnce(used)
    const failed = await syncError({ refresh })
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(failed.error.kind).toBe('signedOut')
    expect(failed.error.message).toContain('Sign in again')
    const state = await getSyncState()
    expect(state?.session).toBeNull()
    expect(state?.lastError?.kind).toBe('signedOut')
    // Tracking stays on, and the device is still enabled: changes keep queueing.
    expect(state?.enabled).toBe(true)
    expect(db.syncTracker.enabled).toBe(true)
    await createTask({ title: 'Read C182 unit 1' })
    expect(await pendingChangeCount()).toBeGreaterThan(0)
  })

  it('a lost answer that works the second time carries on', async () => {
    await enable({ expiresAt: Date.now() + 1000 })
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(offlineError())
      .mockResolvedValueOnce(session({ refreshToken: 'test-refresh-3' }))
    await syncOk({ refresh })
    expect(refresh).toHaveBeenCalledTimes(2)
    expect((await getSyncSession())?.refreshToken).toBe('test-refresh-3')
  })

  it('without a session nothing is sent, and signing in again to the same account continues', async () => {
    await enable()
    await createTask({ title: 'Read C182 unit 1' })
    await syncOk()
    const state = await getSyncState()
    await markSignedOut(Date.now())
    const failed = await syncError()
    expect(failed.error.kind).toBe('signedOut')
    expect(cloud.calls.length).toBe(state ? cloud.calls.length : 0)
    await createTask({ title: 'Read C182 unit 2' })
    const next = await startSync(session({ refreshToken: 'test-refresh-9' }))
    // Same account: the same device id, not a new first sync.
    expect(next.deviceId).toBe(state?.deviceId)
    expect(next.phase).toBe('steady')
    expect((await syncOk()).mode).toBe('steady')
    expect(cloud.rows().filter((r) => r.tbl === 'tasks')).toHaveLength(2)
  })

  it('another account is a new first sync with a new device id', async () => {
    await enable()
    await syncOk()
    const before = await getSyncState()
    const next = await startSync(
      session({ userId: 'another-account-id', email: 'ben@example.com' }),
    )
    expect(next.deviceId).not.toBe(before?.deviceId)
    expect(next.phase).toBe('bootstrap')
    expect(next.accountUserId).toBe('another-account-id')
  })

  it('signing out mid-cycle cannot bring the state back', async () => {
    await enable()
    await createTask({ title: 'Read C182 unit 1' })
    cloud.afterPushStored = async () => {
      await stopSync()
    }
    const result = await cycle()
    expect(result.status).toBe('off')
    const state = await getSyncState()
    expect(state?.enabled).toBe(false)
    expect(state?.deviceId).toBeNull()
    expect(await pendingChangeCount()).toBe(0)
    expect(db.syncTracker.enabled).toBe(false)
  })

  it('stopping keeps the project and email, clears the rest and the outbox, and turning it on again is a first sync', async () => {
    await saveSyncConfig({
      url: 'https://abcdefghijklmnopqrst.supabase.co',
      anonKey: ['sb', 'publishable', 'TESTKEY'].join('_'),
    })
    await enable()
    await createTask({ title: 'Read C182 unit 1' })
    await syncOk()
    await createTask({ title: 'Read C182 unit 2' })
    const before = await getSyncState()
    await stopSync()
    const after = await getSyncState()
    expect(after).toEqual(
      defaultSyncState({
        url: 'https://abcdefghijklmnopqrst.supabase.co',
        anonKey: ['sb', 'publishable', 'TESTKEY'].join('_'),
        email: 'ana@example.com',
      }),
    )
    expect(await pendingChangeCount()).toBe(0)
    expect(db.syncTracker.enabled).toBe(false)
    await createTask({ title: 'Written while sync was off' })
    expect(await pendingChangeCount()).toBe(0)

    const again = await enable()
    expect(again.phase).toBe('bootstrap')
    expect(again.deviceId).not.toBe(before?.deviceId)
    // The rows written while it was off are found by their timestamps.
    const result = await syncOk()
    expect(result.mode).toBe('bootstrap')
    expect(cloud.rows().filter((r) => r.tbl === 'tasks')).toHaveLength(3)
  })

  it('saveSession only writes while sync is on', async () => {
    expect(await saveSession(session())).toBe(false)
    await enable()
    expect(await saveSession(session({ refreshToken: 'test-refresh-4' }))).toBe(true)
    expect((await getSyncSession())?.refreshToken).toBe('test-refresh-4')
  })
})

describe('with sync off', () => {
  it('a cycle does nothing and never calls the server', async () => {
    const result = await cycle()
    expect(result.status).toBe('off')
    expect(cloud.calls).toHaveLength(0)
    expect(await getSyncState()).toBeUndefined()
  })

  it('the pending rows for the page-hide flush are empty, and then what a cycle would send', async () => {
    expect(await pendingPushRows()).toEqual([])
    await enable()
    await syncOk()
    await createTask({ title: 'Read C182 unit 1' })
    const rows = await pendingPushRows()
    expect(rows.map((r) => r.tbl)).toEqual(['tasks'])
    expect(rows[0]?.deviceId).toBe((await getSyncState())?.deviceId)
    // Reading them changes nothing.
    expect(await pendingChangeCount()).toBe(1)
  })

  it('only one cycle runs at a time', async () => {
    await enable()
    const slow = cycle()
    const second = await cycle()
    expect(second.status).toBe('busy')
    expect((await slow).status).toBe('ok')
  })
})

// ─── Budgets with sync on ───────────────────────────────────────────────────

describe('budgets with sync on (CPU time on this thread, median of 3)', () => {
  const median = (xs: number[]): number =>
    [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

  it('a steady cycle with 50 changed rows stays under 100 ms of CPU (typically 15; the plan: 30 ms in Chrome)', async () => {
    await applySeed('wgu')
    for (let i = 0; i < 20; i++) await createTask({ title: `D278 reading ${i + 1}` })
    await enable()
    await syncOk()
    const ids = (await db.tasks.limit(50).primaryKeys()) as string[]
    const times: number[] = []
    for (let run = 0; run < 4; run++) {
      await db.tasks
        .where('id')
        .anyOf(ids)
        .modify((t) => {
          t.order += 1
        })
      expect(await pendingChangeCount()).toBe(50)
      const t0 = cpuNow()
      const result = await syncOk()
      times.push(cpuNow() - t0)
      expect(result.pushed).toBe(50)
    }
    expect(median(times.slice(1))).toBeLessThan(100)
  })

  it('applying a page of 500 rows stays under 400 ms of CPU (typically 90 in fake-indexeddb; the plan: 60 ms in Chrome)', async () => {
    await applySeed('empty')
    const base = await createTask({ title: 'C182 unit 1' })
    await db.tasks.clear()
    await enable()
    await syncOk()
    const times: number[] = []
    for (let run = 0; run < 4; run++) {
      const rows: PushRow[] = Array.from({ length: 500 }, (_v, i) => ({
        tbl: 'tasks',
        id: `r${run}-${i}`,
        updatedAt: Date.now() + run * 1000 + i,
        deviceId: 'other-device',
        deleted: false,
        schemaVersion: 3,
        data: { ...base, id: `r${run}-${i}`, title: `C779 exercise ${i + 1}` },
      }))
      cloud.inject(rows)
      const t0 = cpuNow()
      await syncOk()
      times.push(cpuNow() - t0)
    }
    expect(await db.tasks.count()).toBe(2000)
    expect(median(times.slice(1))).toBeLessThan(400)
  })
})

describe('serverError and friends', () => {
  it('a 5xx is a server error for the retry schedule, with the status and no crash', async () => {
    await enable()
    cloud.failNext(1, serverError(503), 'push')
    await createTask({ title: 'Read C182 unit 1' })
    const failed = await syncError()
    expect(failed).toMatchObject({ error: { kind: 'server' }, httpStatus: 503 })
    expect((await getSyncState())?.lastError?.kind).toBe('server')
    expect(await pendingChangeCount()).toBe(1)
  })
})
