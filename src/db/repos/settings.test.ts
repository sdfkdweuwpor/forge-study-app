import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { DEFAULT_BLOCKED_DOMAINS, SETTINGS_ID, defaultSettings } from '@/db/defaults'
import { onDomainEvent, resetDomainEvents, settleDomainEvents } from '@/db/events'
import {
  ensureSettings,
  getSettings,
  mergeSettings,
  updateSettings,
  withDefaults,
} from '@/db/repos/settings'

/** Simulates a row written by an older release that lacked `key`. */
function dropKey(obj: object, key: string): void {
  Reflect.deleteProperty(obj, key)
}

beforeEach(async () => {
  resetDomainEvents()
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

describe('defaults', () => {
  it('match PLAN §3.2', () => {
    const s = defaultSettings(0)
    expect(s.id).toBe('app')
    expect(s.timer).toMatchObject({
      pomodoroMin: 25,
      shortBreakMin: 5,
      longBreakMin: 15,
      longBreakEvery: 4,
      customMin: 50,
    })
    expect(s.dailyGoalPomodoros).toBe(6)
    expect(s.weekStartsOn).toBe(1)
    expect(s.appearance).toEqual({ theme: 'system', accent: 'blue', reducedMotion: 'system' })
    expect(s.blocker.motivation).toHaveLength(5)
    expect(DEFAULT_BLOCKED_DOMAINS).toHaveLength(11)
  })

  it('are fresh objects each call', () => {
    const a = defaultSettings(0)
    a.blocker.motivation.push('mutated')
    expect(defaultSettings(0).blocker.motivation).toHaveLength(5)
  })
})

describe('ensureSettings', () => {
  it('creates the row once and is idempotent', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const first = await ensureSettings()
    now.mockReturnValue(2_000)
    const second = await ensureSettings()
    const third = await ensureSettings()
    expect(await db.settings.count()).toBe(1)
    expect(second).toEqual(first)
    expect(third).toEqual(first)
    const row = await db.settings.get(SETTINGS_ID)
    expect(row?.createdAt).toBe(1_000)
    expect(row?.updatedAt).toBe(1_000)
  })

  it('is safe when called concurrently', async () => {
    await Promise.all([ensureSettings(), ensureSettings(), ensureSettings()])
    expect(await db.settings.count()).toBe(1)
  })

  it('keeps user values and backfills keys added by later releases', async () => {
    const legacy = defaultSettings(500)
    legacy.profile = { name: 'Sam' }
    dropKey(legacy, 'rewardsSeeded')
    dropKey(legacy.timer, 'autoStartFocus')
    await db.settings.put(legacy)

    const s = await ensureSettings()
    expect(s.profile.name).toBe('Sam')
    expect(s.rewardsSeeded).toBe(false)
    expect('sync' in s).toBe(false)
    expect(s.timer.autoStartFocus).toBe(false)
    expect(s.createdAt).toBe(500)
    expect(await db.settings.get(SETTINGS_ID)).toEqual(s)
  })
})

describe('getSettings', () => {
  it('returns defaults without writing when the row is missing', async () => {
    const s = await getSettings()
    expect(s.appearance.theme).toBe('system')
    expect(await db.settings.count()).toBe(0)
  })
})

describe('updateSettings', () => {
  it('deep-merges nested sections and keeps siblings', async () => {
    await ensureSettings()
    await updateSettings({ timer: { pomodoroMin: 50 }, appearance: { theme: 'dark' } })
    const s = await getSettings()
    expect(s.timer).toMatchObject({ pomodoroMin: 50, shortBreakMin: 5, longBreakMin: 15 })
    expect(s.appearance).toEqual({ theme: 'dark', accent: 'blue', reducedMotion: 'system' })
    expect(s.dailyGoalPomodoros).toBe(6)
  })

  it('replaces arrays, merges records, ignores undefined and applies null', async () => {
    await ensureSettings()
    await updateSettings({ tagColors: { C182: 'blue' } })
    await updateSettings({
      tagColors: { D278: 'green' },
      blocker: { motivation: ['Only this line'], extensionIdOverride: 'abc' },
      profile: { name: undefined },
    })
    let s = await getSettings()
    expect(s.tagColors).toEqual({ C182: 'blue', D278: 'green' })
    expect(s.blocker.motivation).toEqual(['Only this line'])
    expect(s.blocker.mode).toBe('focus')
    expect(s.profile.name).toBe('')
    await updateSettings({ blocker: { extensionIdOverride: null } })
    s = await getSettings()
    expect(s.blocker.extensionIdOverride).toBeNull()
  })

  it('creates the row if needed, preserves createdAt and stamps updatedAt', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    await ensureSettings()
    now.mockReturnValue(5_000)
    const saved = await updateSettings({ weekStartsOn: 0 })
    expect(saved).toMatchObject({ id: 'app', weekStartsOn: 0, createdAt: 1_000, updatedAt: 5_000 })
    expect(await db.settings.get(SETTINGS_ID)).toEqual(saved)

    await db.settings.clear()
    const created = await updateSettings({ dailyGoalPomodoros: 8 })
    expect(created.dailyGoalPomodoros).toBe(8)
    expect(await db.settings.count()).toBe(1)
  })

  it('skips the write, the timestamp bump and the event when nothing changes', async () => {
    const events: string[][] = []
    onDomainEvent('settings.changed', (e) => {
      events.push(e.sections)
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    await ensureSettings()
    await updateSettings({
      timer: { pomodoroMin: 30 },
      blocker: { motivation: ['Only this line'] },
    })
    await settleDomainEvents()
    events.length = 0

    now.mockReturnValue(9_000)
    const before = await db.settings.get(SETTINGS_ID)
    const saved = await updateSettings({
      timer: { pomodoroMin: 30 },
      blocker: { motivation: ['Only this line'] },
      profile: undefined,
    })
    await settleDomainEvents()

    expect(saved).toEqual(before)
    expect(saved.updatedAt).toBe(before?.updatedAt)
    expect(saved.updatedAt).not.toBe(9_000)
    expect(await db.settings.get(SETTINGS_ID)).toEqual(before)
    expect(events).toEqual([])

    // A real change afterwards still writes and emits.
    await updateSettings({ timer: { pomodoroMin: 45 } })
    await settleDomainEvents()
    expect((await db.settings.get(SETTINGS_ID))?.updatedAt).toBe(9_000)
    expect(events).toEqual([['timer']])
  })

  it('never lets a patch overwrite id or timestamps', () => {
    const base = defaultSettings(10)
    const merged = mergeSettings(base, { id: 'evil', createdAt: 0 } as unknown as Parameters<
      typeof mergeSettings
    >[1])
    expect(merged.id).toBe('app')
    expect(merged.createdAt).toBe(10)
  })

  it('does not mutate its inputs', () => {
    const base = defaultSettings(10)
    const snapshot = structuredClone(base)
    const patch = { blocker: { motivation: ['x'] } }
    const merged = mergeSettings(base, patch)
    merged.blocker.motivation.push('y')
    expect(base).toEqual(snapshot)
    expect(patch.blocker.motivation).toEqual(['x'])
  })

  it('emits settings.changed with the touched sections after commit', async () => {
    const events: string[][] = []
    onDomainEvent('settings.changed', (e) => {
      events.push(e.sections)
    })
    await ensureSettings()
    await updateSettings({ timer: { pomodoroMin: 30 }, sound: { volume: 0.2 }, profile: undefined })
    await settleDomainEvents()
    expect(events).toEqual([['timer', 'sound']])
  })
})

describe('withDefaults', () => {
  it('fills nested gaps without touching stored values', () => {
    const stored = defaultSettings(1)
    stored.sound.volume = 0.1
    dropKey(stored.sound, 'ambient')
    const filled = withDefaults(stored)
    expect(filled.sound.volume).toBe(0.1)
    expect(filled.sound.ambient).toBe('none')
    expect(stored.sound.ambient).toBeUndefined()
  })
})
