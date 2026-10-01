import { describe, expect, it } from 'vitest'
import type { FeatureManifest } from '@/app/registry'
import { goalShortcuts } from '../shortcuts'
import { importCommands, whereToImport } from './commands'
import { importShortcuts } from './shortcuts'
import { importSlots, withPlanImport } from './index'

describe('withPlanImport', () => {
  const own: FeatureManifest = {
    id: 'goals',
    slots: [{ slot: 'sidebar.nav.goals', id: 'goals.tree', order: 10, component: () => null }],
    commands: [{ id: 'command.goals.new', title: 'New goal', group: 'Create', run: () => undefined }],
    shortcuts: goalShortcuts,
  }
  const merged = withPlanImport(own)

  it('adds the panel, the command and the shortcut and keeps the manifest’s own', () => {
    expect(merged.id).toBe('goals')
    expect(merged.slots?.map((s) => `${s.slot}/${s.id}`)).toEqual([
      'sidebar.nav.goals/goals.tree',
      'goal.panels/goals.import',
    ])
    expect(merged.commands?.map((c) => c.id)).toEqual(['command.goals.new', 'command.goals.importPlan'])
    expect(merged.shortcuts).toHaveLength(goalShortcuts.length + 1)
  })

  it('works on a manifest with nothing to merge into', () => {
    const bare = withPlanImport({ id: 'goals' })
    expect(bare.slots).toEqual(importSlots)
    expect(bare.commands).toEqual(importCommands)
    expect(bare.shortcuts).toEqual(importShortcuts)
  })

  it('does not collide with the goals shortcuts (same scope and keys, or the same id)', () => {
    const all = merged.shortcuts ?? []
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length)
    const pairs = all.map((s) => `${s.scope}:${s.keys}`)
    expect(new Set(pairs).size).toBe(pairs.length)
    expect(importShortcuts[0]).toMatchObject({ id: 'goals.import', keys: 'i', scope: 'goal' })
  })

  it('links the palette command to the shortcut it names', () => {
    expect(importCommands[0]?.shortcutId).toBe(importShortcuts[0]?.id)
    expect(importCommands[0]?.title).toBe('Import plan from Claude')
  })
})

describe('whereToImport', () => {
  it('opens the panel in place on a goal page', () => {
    expect(whereToImport('/goals/g1')).toEqual({ kind: 'goalPage' })
    expect(whereToImport('/goals/g1/')).toEqual({ kind: 'goalPage' })
  })
  it('goes to the goal from one of its course pages', () => {
    expect(whereToImport('/goals/g1/courses/c9')).toEqual({ kind: 'coursePage', goalId: 'g1' })
  })
  it('offers a new goal everywhere else, including the new-goal route', () => {
    for (const path of ['/', '/goals', '/goals/new', '/tasks/inbox', '/goals/g1/courses', '/progress']) {
      expect(whereToImport(path)).toEqual({ kind: 'list' })
    }
  })
})
