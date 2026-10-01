import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { defaultSyncState } from '@/db/defaults'
import { ensureSettings } from '@/db/repos/settings'
import { createTask } from '@/db/repos/tasks'
import { Devices } from './devices'

let devices: Devices

beforeEach(async () => {
  devices = await Devices.create('A')
  await devices.reset('A')
})

describe('Devices', () => {
  it('keeps each device’s tables, outbox and sync state apart', async () => {
    await ensureSettings()
    await db.syncState.put({ ...defaultSyncState(), enabled: true, phase: 'steady', deviceId: 'a' })
    db.syncTracker.setEnabled(true)
    const onA = await createTask({ title: 'Read C182 unit 1' })
    expect(await db.syncOutbox.count()).toBe(1)

    await devices.switchTo('B')
    expect(await db.tasks.count()).toBe(0)
    expect(await db.syncOutbox.count()).toBe(0)
    expect(await db.syncState.get('device')).toBeUndefined()
    expect(db.syncTracker.enabled).toBe(false)
    await createTask({ title: 'Email the D278 course mentor' })
    expect(await db.syncOutbox.count()).toBe(0)

    await devices.switchTo('A')
    expect((await db.tasks.toArray()).map((t) => t.title)).toEqual(['Read C182 unit 1'])
    expect(await db.tasks.get(onA.id)).toBeDefined()
    expect(await db.syncOutbox.count()).toBe(1)
    expect((await db.syncState.get('device'))?.deviceId).toBe('a')
    expect(db.syncTracker.enabled).toBe(true)
    expect((await devices.rows('B', 'tasks')).length).toBe(1)
  })

  it('writes what it loads without queueing it or re-stamping it', async () => {
    db.syncTracker.setEnabled(true)
    const task = await createTask({ title: 'Read C182 unit 1' }, { now: 1_000 })
    await db.syncOutbox.clear()
    await devices.switchTo('B')
    await devices.switchTo('A')
    expect(await db.syncOutbox.count()).toBe(0)
    expect((await db.tasks.get(task.id))?.updatedAt).toBe(task.updatedAt)
  })

  it('gives each device its own stamp clock and wall clock', async () => {
    devices.add('B', -600_000)
    db.syncTracker.setEnabled(true)
    const a = db.syncTracker.stamp()
    await devices.switchTo('B')
    db.syncTracker.setEnabled(true)
    const b = db.syncTracker.stamp()
    // B's clock is ten minutes behind, and it has never seen A's stamps.
    expect(b).toBeLessThan(a - 500_000)
    expect(devices.now('B')).toBeLessThan(devices.now('A') - 500_000)
    await devices.switchTo('A')
    expect(db.syncTracker.stamp()).toBeGreaterThan(a)
  })
})
