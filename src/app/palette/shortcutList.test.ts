import { describe, expect, it } from 'vitest'
import type { ShortcutDef } from '../registry/types'
import { buildShortcutGroups, countRows } from './shortcutList'

const s = (
  id: string,
  keys: string,
  description: string,
  group: string,
  scope: ShortcutDef['scope'] = 'global',
): ShortcutDef => ({ id, keys, description, group, scope })

const SHORTCUTS: ShortcutDef[] = [
  s('tasks.complete', 'x', 'Complete the selected task', 'Tasks', 'tasks'),
  s('go.today', 'g t', 'Go to Today', 'Navigation'),
  s('palette.open', 'mod+k', 'Open the command palette', 'General'),
  s('quickadd.open', 'q', 'Quick add a task', 'Tasks'),
  s('zeta', 'z', 'Zeta thing', 'Zeta'),
  s('alpha', 'a', 'Alpha thing', 'Alpha'),
  s('shortcuts.open', '?', 'Show keyboard shortcuts', 'General'),
]

describe('buildShortcutGroups', () => {
  it('groups by heading: known headings first in their order, the rest A to Z', () => {
    expect(buildShortcutGroups(SHORTCUTS).map((g) => g.heading)).toEqual([
      'General',
      'Navigation',
      'Tasks',
      'Alpha',
      'Zeta',
    ])
  })

  it('lists shortcuts that work everywhere before scoped ones, and labels the scope', () => {
    const tasks = buildShortcutGroups(SHORTCUTS).find((g) => g.heading === 'Tasks')
    expect(tasks?.rows.map((r) => [r.id, r.scopeLabel])).toEqual([
      ['quickadd.open', null],
      ['tasks.complete', 'Tasks'],
    ])
  })

  it('keeps the keys spec for the Kbd component', () => {
    const general = buildShortcutGroups(SHORTCUTS)[0]
    expect(general?.rows.map((r) => r.keys)).toEqual(['mod+k', '?'])
  })

  it('counts every registered shortcut when there is no query', () => {
    expect(countRows(buildShortcutGroups(SHORTCUTS))).toBe(SHORTCUTS.length)
    expect(buildShortcutGroups([])).toEqual([])
  })

  it('filters by description, group, scope and keys; every word must match', () => {
    const ids = (q: string) =>
      buildShortcutGroups(SHORTCUTS, q).flatMap((g) => g.rows.map((r) => r.id))
    expect(ids('quick')).toEqual(['quickadd.open'])
    expect(ids('NAVIGATION')).toEqual(['go.today'])
    expect(ids('tasks')).toEqual(['quickadd.open', 'tasks.complete'])
    expect(ids('comp')).toEqual(['tasks.complete']) // a word prefix, not any substring
    expect(ids('omplete')).toEqual([])
    expect(ids('g t')).toEqual(['go.today']) // a key sequence
    expect(ids('complete task')).toEqual(['tasks.complete'])
    expect(ids('complete palette')).toEqual([])
    expect(ids('   ')).toHaveLength(SHORTCUTS.length)
    expect(ids('?')).toEqual(['shortcuts.open'])
  })

  it('searches the printed keycaps too', () => {
    const keysText = (keys: string) => (keys === 'mod+k' ? 'Ctrl K' : keys)
    const ids = buildShortcutGroups(SHORTCUTS, 'ctrl k', keysText).flatMap((g) =>
      g.rows.map((r) => r.id),
    )
    expect(ids).toEqual(['palette.open'])
  })

  it('drops groups that end up empty', () => {
    expect(buildShortcutGroups(SHORTCUTS, 'zeta').map((g) => g.heading)).toEqual(['Zeta'])
  })
})
