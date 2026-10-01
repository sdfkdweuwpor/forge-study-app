import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The two modules the manifest reaches: what it asks of the tracker, and the engine it starts lazily.
const tracker = vi.hoisted(() => ({ on: false, writes: new Set<() => void>() }))
const engine = vi.hoisted(() => ({ started: 0, wrote: [] as (boolean | undefined)[] }))

vi.mock('./queries', () => ({
  syncIsOn: () => tracker.on,
  onTrackedWrite: (fn: () => void) => {
    tracker.writes.add(fn)
    return () => tracker.writes.delete(fn)
  },
}))
vi.mock('./engine', () => ({
  startEngine: (options: { wrote?: boolean } = {}) => {
    engine.started += 1
    engine.wrote.push(options.wrote)
    return { syncNow: () => undefined, stop: () => undefined }
  },
}))

import type { FeatureManifest } from '@/app/registry'

/** The manifest is module state (it watches once per page load): every test loads it afresh. */
async function load(): Promise<FeatureManifest> {
  vi.resetModules()
  return (await import('./feature')).default
}
const write = (): void => {
  for (const fn of [...tracker.writes]) fn()
}
/** The engine is imported lazily: let that happen. */
const settle = (): Promise<void> => vi.dynamicImportSettled()

describe('the sync manifest', () => {
  let boot: () => Promise<void>

  beforeEach(async () => {
    tracker.on = false
    tracker.writes.clear()
    engine.started = 0
    engine.wrote = []
    const manifest = await load()
    boot = async () => {
      await manifest.onAppStart?.({ now: 1_790_000_000_000, today: '2026-09-30' })
    }
  })
  afterEach(() => {
    tracker.writes.clear()
  })

  it('does nothing while sync is off: no engine is loaded, and nothing starts', async () => {
    await boot()
    await settle()
    expect(engine.started).toBe(0)
  })

  it('starts the engine at once when sync is on at boot', async () => {
    tracker.on = true
    await boot()
    await settle()
    expect(engine.started).toBe(1)
    expect(engine.wrote).toEqual([false])
  })

  it('starts one in a tab that was open before sync was turned on, on its first tracked write', async () => {
    await boot()
    tracker.on = true // another tab turned it on; this tab heard
    write()
    await settle()
    expect(engine.started).toBe(1)
    // The engine did not hear the write that started it: it is told.
    expect(engine.wrote).toEqual([true])
  })

  it('keeps watching, so a tab whose engine stopped starts a new one on its next write', async () => {
    tracker.on = true
    await boot()
    await settle()
    // Sync was turned off in another tab (this tab's engine stopped) and on again: the next write asks again.
    write()
    await settle()
    write()
    await settle()
    expect(engine.started).toBe(3)
  })

  it('does not start an engine for a write made while sync is off', async () => {
    await boot()
    write()
    await settle()
    expect(engine.started).toBe(0)
  })

  it('watches once, however often the app starts (it also runs when the day rolls over)', async () => {
    await boot()
    await boot()
    await boot()
    expect(tracker.writes.size).toBe(1)
  })
})
