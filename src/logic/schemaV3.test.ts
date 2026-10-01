import { describe, expect, it } from 'vitest'
import { migrateTablesV2toV3, settingsToV3, V3_LOCAL_TABLES } from './schemaV3'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const V2_SYNC = { enabled: false, url: null, anonKey: null, lastSyncAt: null }

describe('settingsToV3', () => {
  it('drops `sync` and keeps every other field, without touching its input', () => {
    const v2 = { id: 'app', updatedAt: 5, profile: { name: 'Ana' }, sync: V2_SYNC }
    const before = structuredClone(v2)
    const out = settingsToV3(v2)
    expect(out).toEqual({ id: 'app', updatedAt: 5, profile: { name: 'Ana' } })
    expect(v2).toEqual(before)
  })

  it('is idempotent: a row without `sync` comes back as the same object', () => {
    const v3 = { id: 'app', profile: { name: 'Ana' } }
    expect(settingsToV3(v3)).toBe(v3)
    const once = settingsToV3({ id: 'app', sync: V2_SYNC })
    expect(settingsToV3(once)).toBe(once)
  })

  it('drops even an odd `sync` (null, a string) and leaves non-objects alone', () => {
    expect(settingsToV3({ id: 'app', sync: null })).toEqual({ id: 'app' })
    expect(settingsToV3({ id: 'app', sync: 'yes' })).toEqual({ id: 'app' })
    expect(settingsToV3(null)).toBeNull()
    expect(settingsToV3('app')).toBe('app')
  })
})

describe('migrateTablesV2toV3', () => {
  it('maps the settings row, copies every other table as it is, and drops sync bookkeeping', () => {
    const task = { id: 't1', title: 'Email mentor', updatedAt: 9 }
    const tables = {
      settings: [{ id: 'app', sync: V2_SYNC, dailyGoalPomodoros: 6 }],
      tasks: [task],
      files: [],
      syncOutbox: [{ tbl: 'tasks', id: 't1', at: 1 }],
      syncState: [{ id: 'device', enabled: true }],
    }
    const before = structuredClone(tables)
    const out = migrateTablesV2toV3(tables, NOW)
    expect(out).toEqual({
      settings: [{ id: 'app', dailyGoalPomodoros: 6 }],
      tasks: [task],
      files: [],
    })
    // Rows other than settings are the very same objects; the input is not changed.
    expect(out.tasks?.[0]).toBe(task)
    expect(out.tasks).not.toBe(tables.tasks)
    expect(tables).toEqual(before)
  })

  it('names exactly the two bookkeeping tables as never carried', () => {
    expect([...V3_LOCAL_TABLES]).toEqual(['syncOutbox', 'syncState'])
  })

  it('running it twice gives the same tables', () => {
    const once = migrateTablesV2toV3({ settings: [{ id: 'app', sync: V2_SYNC }], goals: [] }, NOW)
    expect(migrateTablesV2toV3(once, NOW)).toEqual(once)
  })
})
