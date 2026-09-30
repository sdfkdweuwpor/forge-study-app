import { describe, expect, it } from 'vitest'
import {
  APPEND_ONLY_TABLES,
  isSyncTable,
  LOCAL_TABLES,
  nextStamp,
  nextXpEventId,
  SETTINGS_DEVICE_PATHS,
  starterRewardId,
  SYNC_BOOKKEEPING_TABLES,
  SYNC_TABLES,
  syncedSettings,
  syncedSettingsChanged,
  xpEventId,
} from './syncTables'

const settings = (over: Record<string, unknown> = {}) => ({
  id: 'app',
  createdAt: 1,
  updatedAt: 2,
  profile: { name: 'Ana' },
  appearance: { theme: 'dark', accent: 'teal', reducedMotion: 'system' },
  notifications: { enabled: true, promptedAt: 5 },
  dailyGoalPomodoros: 6,
  blocker: {
    mode: 'focus',
    motivation: ['Keep going'],
    extensionIdOverride: 'abc',
    lastSyncedAt: 10,
    eventsCursor: 20,
    blocklistSeeded: true,
  },
  backup: { lastExportAt: 30, remindWeekly: true, lastRemindedAt: 40 },
  ...over,
})

describe('the table lists', () => {
  it('are disjoint, and the helpers agree with them', () => {
    const local = new Set<string>(LOCAL_TABLES)
    expect(SYNC_TABLES.filter((t) => local.has(t))).toEqual([])
    for (const t of SYNC_TABLES) expect(isSyncTable(t)).toBe(true)
    for (const t of LOCAL_TABLES) expect(isSyncTable(t)).toBe(false)
    expect(isSyncTable('nope')).toBe(false)
    for (const t of SYNC_BOOKKEEPING_TABLES) expect(local.has(t)).toBe(true)
    for (const t of APPEND_ONLY_TABLES) expect(isSyncTable(t)).toBe(true)
    expect([...APPEND_ONLY_TABLES].sort()).toEqual(['blockEvents', 'xpEvents'])
  })
})

describe('syncedSettings', () => {
  it('drops the device paths, keeping their siblings', () => {
    const out = syncedSettings(settings())
    expect(out).not.toHaveProperty('appearance')
    expect(out).not.toHaveProperty('notifications')
    expect(out?.blocker).toEqual({
      mode: 'focus',
      motivation: ['Keep going'],
      blocklistSeeded: true,
    })
    expect(out?.backup).toEqual({ lastExportAt: 30, remindWeekly: true })
    expect(out).toMatchObject({ id: 'app', updatedAt: 2, dailyGoalPomodoros: 6 })
  })

  it('drops updatedAt only for comparing, and never changes its input', () => {
    const input = settings()
    const copy = structuredClone(input)
    expect(syncedSettings(input, { forCompare: true })).not.toHaveProperty('updatedAt')
    expect(input).toEqual(copy)
  })

  it('keeps theme and accent on the device (a phone in dark mode, a laptop in light)', () => {
    expect(SETTINGS_DEVICE_PATHS).toContain('appearance')
  })

  it('returns null for something that is not an object', () => {
    expect(syncedSettings(null)).toBeNull()
    expect(syncedSettings('app')).toBeNull()
    expect(syncedSettings([1])).toBeNull()
  })

  it('tolerates a row whose section is missing or not an object', () => {
    expect(syncedSettings({ id: 'app', blocker: null })).toEqual({ id: 'app', blocker: null })
    expect(syncedSettings({ id: 'app' })).toEqual({ id: 'app' })
  })
})

describe('syncedSettingsChanged', () => {
  it('is false when only device fields or the stamp changed', () => {
    const before = settings()
    const after = settings({
      updatedAt: 99,
      appearance: { theme: 'light', accent: 'blue', reducedMotion: 'on' },
      notifications: { enabled: false, promptedAt: null },
      blocker: {
        ...before.blocker,
        eventsCursor: 999,
        lastSyncedAt: 998,
        extensionIdOverride: null,
      },
      backup: { ...before.backup, lastRemindedAt: 997 },
    })
    expect(syncedSettingsChanged(before, after)).toBe(false)
  })

  it('is true when a synced field changed, deep or shallow', () => {
    const before = settings()
    expect(syncedSettingsChanged(before, settings({ dailyGoalPomodoros: 8 }))).toBe(true)
    expect(
      syncedSettingsChanged(
        before,
        settings({ blocker: { ...before.blocker, motivation: ['Another line'] } }),
      ),
    ).toBe(true)
    expect(
      syncedSettingsChanged(before, settings({ backup: { ...before.backup, lastExportAt: 31 } })),
    ).toBe(true)
  })

  it('treats a row appearing or disappearing as a change', () => {
    expect(syncedSettingsChanged(undefined, settings())).toBe(true)
    expect(syncedSettingsChanged(settings(), undefined)).toBe(true)
    expect(syncedSettingsChanged(undefined, undefined)).toBe(false)
  })
})

describe('nextStamp', () => {
  it('is the clock when it is ahead', () => {
    expect(nextStamp(5_000, 1_000, 2_000)).toBe(5_000)
  })
  it('stays past the last stamp when the clock stands still or goes back', () => {
    expect(nextStamp(1_000, 1_000, 0)).toBe(1_001)
    expect(nextStamp(900, 1_000, 0)).toBe(1_001)
  })
  it('stays past the newest remote stamp seen (an edit after seeing a change beats it)', () => {
    expect(nextStamp(1_000, 1_000, 9_000)).toBe(9_001)
  })
})

describe('XP event and starter reward ids', () => {
  it('numbers the events of a key: award, undo, award is #0 #1 #2', () => {
    expect(xpEventId('dailyGoal:2026-09-29', 0)).toBe('xp:dailyGoal:2026-09-29#0')
    expect(nextXpEventId('task:a', [])).toBe('xp:task:a#0')
    expect(nextXpEventId('task:a', ['xp:task:a#0'])).toBe('xp:task:a#1')
    expect(nextXpEventId('task:a', ['xp:task:a#0', 'xp:task:a#1'])).toBe('xp:task:a#2')
  })

  it('counts older uuid events too, and skips a number already taken', () => {
    expect(nextXpEventId('task:a', ['0b1f-uuid'])).toBe('xp:task:a#1')
    expect(nextXpEventId('task:a', ['xp:task:a#1'])).toBe('xp:task:a#2')
  })

  it('gives starter rewards fixed ids', () => {
    expect(starterRewardId(0)).toBe('starter-reward:0')
    expect(starterRewardId(2)).toBe('starter-reward:2')
  })
})
