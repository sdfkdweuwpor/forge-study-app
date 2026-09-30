/**
 * The goals feature's cloud-sync wiring (PLAN §4.7.5): the daily roll-forward waits for the start-up sync
 * without holding the start-up chain, and a goal whose plan two devices both re-planned is healed after
 * a pull.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Tests clear the fake database directly; the lint rule keeps app code on repos and queries.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { db } from '@/db/db'
import { emit, resetDomainEvents, settleDomainEvents, subscribeAll } from '@/db/events'
import { ensureSettings } from '@/db/repos/settings'
import { resetSyncEngineForTests, runSyncCycle, startSync } from '@/db/repos/sync'
import { resetStartupSync, settleStartupSync } from '@/db/repos/syncGate'
import type { SyncSession, Task } from '@/db/types'
import { applySeed } from '@/dev/seed'
import { FakeSyncServer, TEST_USER_ID } from '@/test/fakeSyncServer'
import manifest from './feature'

const TODAY = '2026-09-29'
const NOW = new Date(2026, 8, 29, 9, 30).getTime()

beforeEach(async () => {
  resetDomainEvents()
  resetStartupSync()
  resetSyncEngineForTests()
  db.syncTracker.setEnabled(false)
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
  db.syncTracker.setEnabled(false)
  vi.useRealTimers()
})

/** The day the roll-forward last ran, from the settings row. */
const lastRun = async (): Promise<string | null> =>
  (await db.settings.get('app'))?.scheduling.lastDailyRunDay ?? null

const session: SyncSession = {
  accessToken: 'test-access',
  refreshToken: 'test-refresh',
  expiresAt: Date.now() + 60 * 60_000,
  userId: TEST_USER_ID,
  email: 'ana@example.com',
}

describe('the daily roll-forward and the start-up sync', () => {
  beforeEach(async () => {
    await ensureSettings()
  })

  it('runs the roll-forward without waiting when sync is off', async () => {
    await manifest.onAppStart?.({ now: NOW, today: TODAY })
    await vi.waitFor(async () => expect(await lastRun()).toBe(TODAY), { timeout: 1500 })
  })

  it('returns at once when sync is on: the start-up chain is never held, the roll-forward waits', async () => {
    db.syncTracker.setEnabled(true)
    const t0 = performance.now()
    await manifest.onAppStart?.({ now: NOW, today: TODAY })
    expect(performance.now() - t0).toBeLessThan(500)
    await new Promise((r) => setTimeout(r, 60))
    expect(await lastRun()).toBeNull()
    settleStartupSync()
    await vi.waitFor(async () => expect(await lastRun()).toBe(TODAY), { timeout: 1500 })
  })

  it('goes on after 8 seconds when the sync never ends', async () => {
    db.syncTracker.setEnabled(true)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await manifest.onAppStart?.({ now: NOW, today: TODAY })
    await vi.advanceTimersByTimeAsync(7999)
    expect(await lastRun()).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()
    await vi.waitFor(async () => expect(await lastRun()).toBe(TODAY), { timeout: 1500 })
  })

  it('leaves the engine free to start: a feature that starts after goals begins its first cycle at once, and the roll-forward follows it', async () => {
    resetSyncEngineForTests()
    await startSync(session)
    const cloud = new FakeSyncServer()
    // The roll-forward must not have run when the first pull is answered.
    const seenAtPull: (string | null)[] = []
    cloud.beforePullAnswer = async () => {
      seenAtPull.push(await lastRun())
    }
    // What `runAppStart` does (features one after the other), with the sync feature after goals.
    const syncFeature = {
      onAppStart: async (): Promise<void> => {
        void runSyncCycle(cloud, { appVersion: 'test' })
      },
    }
    const t0 = performance.now()
    for (const start of [manifest.onAppStart, syncFeature.onAppStart]) {
      await start?.({ now: NOW, today: TODAY })
    }
    // Both hooks returned at once, so the engine's first call went out without waiting for the gate's 8 s.
    await vi.waitFor(() => expect(cloud.calls.length).toBeGreaterThan(0), { timeout: 1500 })
    expect(performance.now() - t0).toBeLessThan(4000)
    await vi.waitFor(async () => expect(await lastRun()).toBe(TODAY), { timeout: 4000 })
    expect(seenAtPull.length).toBeGreaterThan(0)
    expect(seenAtPull.every((day) => day === null)).toBe(true)
  })
})

describe('sync.applied: duplicate plan tasks', () => {
  it('re-plans a goal that has two open tasks for one plan item, keeping the older', async () => {
    await applySeed('wgu')
    subscribeAll(manifest.domainHandlers ?? [])
    const plan = (await db.tasks.toArray()).filter(
      (t) => t.source === 'schedule' && t.status !== 'done' && t.scheduleKey !== null,
    )
    const original = plan[0] as Task
    const copy: Task = {
      ...original,
      id: 'plan-copy-from-the-phone',
      createdAt: original.createdAt + 1000,
      updatedAt: original.createdAt + 1000,
    }
    await db.tasks.add(copy)

    emit({ type: 'sync.applied', tables: ['tasks'], goalIds: [original.goalId ?? ''] })
    await settleDomainEvents()

    expect(await db.tasks.get(original.id)).toBeDefined()
    expect(await db.tasks.get(copy.id)).toBeUndefined()
  })

  it('does nothing when the pull brought no plan tasks', async () => {
    await applySeed('wgu')
    subscribeAll(manifest.domainHandlers ?? [])
    const before = await db.tasks.count()
    emit({ type: 'sync.applied', tables: ['rewards'], goalIds: [] })
    await settleDomainEvents()
    expect(await db.tasks.count()).toBe(before)
  })
})
