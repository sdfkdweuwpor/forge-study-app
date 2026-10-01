import { lazy } from 'react'
import { describe, expect, it } from 'vitest'
import { ROUTES, type RouteName } from '../router/routes'
import { discovered, manifests, registryProblems } from './discover'
import { buildRegistry, validateManifests } from './registry'
import { SLOT_IDS } from './slots'
import type { FeatureManifest } from './types'

const Page = lazy(() => Promise.resolve({ default: () => null }))
const Noop = () => null

describe('validateManifests', () => {
  it('accepts a clean set', () => {
    const a: FeatureManifest = {
      id: 'a',
      routes: { focus: Page },
      commands: [{ id: 'a.cmd', title: 'A', group: 'Go to', shortcutId: 'a.s', run: () => {} }],
      shortcuts: [{ id: 'a.s', keys: 'x', description: 'x', group: 'A', scope: 'tasks' }],
    }
    const b: FeatureManifest = {
      id: 'b',
      routes: { goals: Page },
      // same keys, different scope: allowed
      shortcuts: [{ id: 'b.s', keys: 'x', description: 'x', group: 'B', scope: 'today' }],
    }
    expect(validateManifests([a, b])).toEqual([])
  })

  it('fails on duplicate route owners', () => {
    const problems = validateManifests([
      { id: 'a', routes: { goals: Page } },
      { id: 'b', routes: { goals: Page } },
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/Route "goals".*a and b/)
  })

  it('fails on duplicate command ids', () => {
    const cmd = { id: 'dup', title: 'T', group: 'Create' as const, run: () => {} }
    expect(
      validateManifests([
        { id: 'a', commands: [cmd] },
        { id: 'b', commands: [cmd] },
      ]),
    ).toEqual([expect.stringMatching(/Command "dup"/)])
  })

  it('fails on duplicate shortcut keys within a scope, including spelling variants', () => {
    const problems = validateManifests([
      {
        id: 'a',
        shortcuts: [{ id: 'a.s', keys: 'mod+K', description: '', group: 'G', scope: 'global' }],
      },
      {
        id: 'b',
        shortcuts: [{ id: 'b.s', keys: 'mod+k', description: '', group: 'G', scope: 'global' }],
      },
    ])
    expect(problems).toEqual([expect.stringMatching(/"mod\+k" in scope "global"/)])
  })

  it('fails on duplicate shortcut ids', () => {
    const s = { id: 'same', keys: 'x', description: '', group: 'G', scope: 'global' as const }
    const t = { ...s, keys: 'y' }
    expect(
      validateManifests([
        { id: 'a', shortcuts: [s] },
        { id: 'b', shortcuts: [t] },
      ]),
    ).toEqual([expect.stringMatching(/Shortcut id "same"/)])
  })

  it('fails when a single key is also the prefix of a sequence in the same scope', () => {
    const problems = validateManifests([
      {
        id: 'a',
        shortcuts: [
          { id: 'a.g', keys: 'g', description: '', group: 'G', scope: 'global' },
          { id: 'a.gt', keys: 'g t', description: '', group: 'G', scope: 'global' },
        ],
      },
    ])
    expect(problems).toEqual([expect.stringMatching(/prefix/)])
  })

  it('fails on unknown routes, duplicate feature ids, duplicate slot ids and dangling shortcutId', () => {
    const problems = validateManifests([
      { id: 'a', routes: { nope: Page } as unknown as FeatureManifest['routes'] },
      {
        id: 'a',
        slots: [
          { slot: 'today.main', id: 's', order: 1, component: Noop },
          { slot: 'today.main', id: 's', order: 2, component: Noop },
        ],
        commands: [{ id: 'c', title: 'C', group: 'Help', shortcutId: 'missing', run: () => {} }],
      },
    ])
    expect(problems.join('\n')).toMatch(/unknown route "nope"/)
    expect(problems.join('\n')).toMatch(/Duplicate feature id "a"/)
    expect(problems.join('\n')).toMatch(/Slot contribution "s"/)
    expect(problems.join('\n')).toMatch(/unknown shortcut "missing"/)
  })
})

describe('buildRegistry', () => {
  it('orders slot contributions by `order` and providers by `order`', () => {
    const r = buildRegistry([
      {
        id: 'a',
        slots: [{ slot: 'today.main', id: 'late', order: 20, component: Noop }],
        providers: [{ order: 5, component: ({ children }) => children }],
      },
      {
        id: 'b',
        slots: [{ slot: 'today.main', id: 'early', order: 10, component: Noop }],
        providers: [{ order: 1, component: ({ children }) => children }],
      },
    ])
    expect(r.slots('today.main').map((c) => c.id)).toEqual(['early', 'late'])
    expect(r.slots('goal.panels')).toEqual([])
    expect(r.providers.map((p) => p.order)).toEqual([1, 5])
  })

  it('collects pages, commands and shortcuts across manifests', () => {
    const r = buildRegistry([
      {
        id: 'a',
        routes: { focus: Page },
        commands: [{ id: 'c1', title: 'One', group: 'Focus', run: () => {} }],
      },
      {
        id: 'b',
        shortcuts: [{ id: 's1', keys: 'q', description: '', group: 'G', scope: 'global' }],
      },
    ])
    expect(r.pages.get('focus')).toBe(Page)
    expect(r.commands.map((c) => c.id)).toEqual(['c1'])
    expect(r.shortcuts.map((s) => s.id)).toEqual(['s1'])
  })
})

describe('real feature manifests', () => {
  it('have no duplicate route owners, command ids or shortcut keys', () => {
    expect(registryProblems).toEqual([])
  })

  it('use their folder name as id and only register routes they own', () => {
    for (const [folder, manifest] of discovered) {
      expect(manifest.id, folder).toBe(folder)
      for (const name of Object.keys(manifest.routes ?? {}) as RouteName[]) {
        expect(ROUTES[name].owner, `${folder} registers ${name}`).toBe(folder)
      }
    }
  })

  it('include a stub manifest for every feature that owns a route', () => {
    const owners = new Set(
      Object.values(ROUTES)
        .map((r) => r.owner)
        .filter((o) => o !== 'app'),
    )
    const have = new Set(discovered.map(([folder]) => folder))
    expect([...owners].filter((o) => !have.has(o))).toEqual([])
  })

  it('only contribute to known slots', () => {
    const known = new Set<string>(SLOT_IDS)
    for (const m of manifests)
      for (const s of m.slots ?? []) expect(known.has(s.slot), s.slot).toBe(true)
  })
})
