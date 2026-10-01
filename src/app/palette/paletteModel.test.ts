import { describe, expect, it } from 'vitest'
import type { CommandCtx, CommandDef, SearchResult, ShortcutDef } from '../registry/types'
import {
  buildPaletteGroups,
  indexItems,
  rankCommands,
  rankResults,
  type PaletteInput,
  type ProviderResults,
} from './paletteModel'
import type { RecentEntry } from './recents'

const ctx: CommandCtx = {
  now: 0,
  today: '2026-09-29',
  navigate: () => {},
  overlays: { open: () => {}, close: () => {}, toggle: () => {}, isOpen: () => false },
  invoke: () => {},
}

const run = () => {}
const cmd = (id: string, title: string, group: CommandDef['group'], more: Partial<CommandDef> = {}) =>
  ({ id, title, group, run, ...more }) satisfies CommandDef

const COMMANDS: CommandDef[] = [
  cmd('go.today', 'Go to Today', 'Go to', { shortcutId: 'go.today', keywords: ['home'] }),
  cmd('go.progress', 'Go to Progress', 'Go to', { keywords: ['stats', 'charts'] }),
  cmd('go.settings', 'Go to Settings', 'Go to', { keywords: ['preferences'] }),
  cmd('new', 'New task', 'Create', { shortcutId: 'quickadd.open', keywords: ['add', 'quick'] }),
  cmd('theme', 'Toggle theme', 'View', { keywords: ['dark', 'light'] }),
  cmd('shortcuts', 'Keyboard shortcuts', 'Help', { shortcutId: 'shortcuts.open' }),
  cmd('focus', 'Start focus', 'Focus'),
]

const SHORTCUTS: ShortcutDef[] = [
  { id: 'go.today', keys: 'g t', description: '', group: 'Navigation', scope: 'global' },
  { id: 'quickadd.open', keys: 'q', description: '', group: 'General', scope: 'global' },
  { id: 'shortcuts.open', keys: '?', description: '', group: 'General', scope: 'global' },
]

const result = (id: string, title: string, subtitle?: string): SearchResult => ({
  id,
  title,
  ...(subtitle ? { subtitle } : {}),
  run,
})

const TASKS: ProviderResults = {
  providerId: 'tasks',
  group: 'Tasks',
  results: [
    result('t1', 'Read chapter 4: Networks', 'C182 · due tomorrow'),
    result('t2', 'Practice quiz: variables and loops', 'D278'),
    result('t3', 'Outline the HTML5 essay'),
  ],
}
const GOALS: ProviderResults = {
  providerId: 'goals',
  group: 'Goals',
  results: [result('g1', 'WGU B.S. Computer Science')],
}
const COURSES: ProviderResults = {
  providerId: 'courses',
  group: 'Pages',
  results: [result('c1', 'C182 Introduction to IT', 'Course')],
}

function build(over: Partial<PaletteInput> = {}) {
  return buildPaletteGroups({
    query: '',
    mode: 'all',
    commands: COMMANDS,
    shortcuts: SHORTCUTS,
    ctx,
    recents: [],
    providers: [],
    ...over,
  })
}

const headings = (groups: ReturnType<typeof build>) => groups.map((g) => g.heading)
const titles = (groups: ReturnType<typeof build>, heading: string) =>
  groups.find((g) => g.heading === heading)?.items.map((i) => i.title) ?? []

describe('empty query', () => {
  it('suggests actions and pages, in order, with shortcut hints', () => {
    const groups = build()
    expect(headings(groups)).toEqual(['Actions', 'Pages'])
    // Actions follow the command-group order, not registration order.
    expect(titles(groups, 'Actions')).toEqual([
      'New task',
      'Start focus',
      'Toggle theme',
      'Keyboard shortcuts',
    ])
    expect(groups[0]?.items[0]?.shortcut).toBe('q')
    expect(groups[1]?.items[0]?.shortcut).toBe('g t')
    expect(groups[1]?.items[1]?.shortcut).toBeUndefined()
  })

  it('leads with recents: commands by id, results as saved', () => {
    const recents: RecentEntry[] = [
      { kind: 'result', providerId: 'tasks', id: 't1', title: 'Read chapter 4', group: 'Tasks', subtitle: 'C182' },
      { kind: 'command', id: 'theme' },
      { kind: 'command', id: 'removed.command' },
    ]
    const groups = build({ recents })
    expect(groups[0]).toMatchObject({ id: 'recent', heading: 'Recent' })
    expect(groups[0]?.items.map((i) => i.title)).toEqual(['Read chapter 4', 'Toggle theme'])
    expect(groups[0]?.items[0]?.subtitle).toBe('Tasks · C182')
    expect(groups[0]?.items[0]?.action.type).toBe('recent')
    // The same command may be in Recent and Actions: ids stay unique.
    const ids = groups.flatMap((g) => g.items.map((i) => i.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('shows at most five recents', () => {
    const recents: RecentEntry[] = Array.from({ length: 8 }, (_, i) => ({
      kind: 'result',
      providerId: 'tasks',
      id: `t${i}`,
      title: `Task ${i}`,
      group: 'Tasks',
    }))
    expect(build({ recents })[0]?.items).toHaveLength(5)
  })

  it('does not list provider results', () => {
    expect(headings(build({ providers: [TASKS] }))).toEqual(['Actions', 'Pages'])
  })

  it('search mode leaves out actions and command recents', () => {
    const recents: RecentEntry[] = [
      { kind: 'command', id: 'theme' },
      { kind: 'result', providerId: 'tasks', id: 't1', title: 'Read chapter 4', group: 'Tasks' },
    ]
    const groups = build({ mode: 'search', recents })
    expect(headings(groups)).toEqual(['Recent', 'Pages'])
    expect(titles(groups, 'Recent')).toEqual(['Read chapter 4'])
  })
})

describe('with a query', () => {
  it('fuzzy-matches commands and highlights the title', () => {
    const groups = build({ query: 'thm' })
    expect(titles(groups, 'Actions')).toEqual(['Toggle theme'])
    const item = groups[0]?.items[0]
    expect(item?.matches?.map((i) => item.title[i]).join('')).toBe('thm')
  })

  it('finds a page by typing its name', () => {
    const groups = build({ query: 'prog' })
    expect(headings(groups)).toEqual(['Pages'])
    expect(titles(groups, 'Pages')).toEqual(['Go to Progress'])
  })

  it('falls back to keywords by prefix, ranked below title matches, without highlights', () => {
    const groups = build({ query: 'dark' })
    const item = groups[0]?.items[0]
    expect(item?.title).toBe('Toggle theme')
    expect(item?.matches).toBeUndefined()
    // "sta": "Start focus" matches by title, "Go to Progress" only by its keyword "stats".
    const ranked = rankCommands(COMMANDS, 'sta')
    expect(ranked.map((r) => r.item.id)).toEqual(['focus', 'go.progress'])
    // A fuzzy scatter across several keywords is not a match.
    expect(rankCommands(COMMANDS, 'read')).toEqual([])
  })

  it('lists provider groups after Actions and Pages: Tasks, Goals, then others A to Z', () => {
    const extra: ProviderResults = { providerId: 'x', group: 'Notes', results: [result('n', 'Read notes')] }
    const groups = build({ query: 'read', providers: [extra, GOALS, TASKS] })
    // Providers are trusted to have found their results, so Goals is listed although no title matches;
    // it follows the groups that do.
    expect(headings(groups)).toEqual(['Tasks', 'Notes', 'Goals'])
  })

  it('puts groups that match the text ahead of groups that only hold provider results', () => {
    const pages: ProviderResults = {
      providerId: 'courses',
      group: 'Pages',
      results: [result('c1', 'D278 Scripting and Programming')],
    }
    // "Pages" comes first by default, but nothing in it matches "read chap"; Tasks does.
    const groups = build({ query: 'read chap', providers: [pages, TASKS] })
    expect(headings(groups)).toEqual(['Tasks', 'Pages'])
    expect(groups[0]?.items[0]?.title).toBe('Read chapter 4: Networks')
  })

  it('merges a "Pages" provider into the Pages group', () => {
    const groups = build({ query: 'c182', providers: [COURSES] })
    expect(headings(groups)).toEqual(['Pages'])
    expect(titles(groups, 'Pages')).toEqual(['C182 Introduction to IT'])
    const withGoTo = build({ query: 'to', providers: [COURSES] })
    expect(titles(withGoTo, 'Pages')).toContain('Go to Today')
  })

  it('caps each group', () => {
    const many: ProviderResults = {
      providerId: 'tasks',
      group: 'Tasks',
      results: Array.from({ length: 20 }, (_, i) => result(`t${i}`, `Read part ${i}`)),
    }
    expect(build({ query: 'read', providers: [many] })[0]?.items).toHaveLength(8)
  })

  it('hides commands whose `when` is false or throws', () => {
    const commands = [
      cmd('a', 'Alpha action', 'Create', { when: () => false }),
      cmd('b', 'Alpha beta', 'Create', {
        when: () => {
          throw new Error('nope')
        },
      }),
      cmd('c', 'Alpha gamma', 'Create', { when: (c) => c.today === '2026-09-29' }),
    ]
    expect(titles(build({ commands, query: 'alpha' }), 'Actions')).toEqual(['Alpha gamma'])
  })

  it('lists two commands with the same group and title once, keeping the one with a shortcut', () => {
    const commands = [
      cmd('a.new', 'New task', 'Create'),
      cmd('b.new', 'New task', 'Create', { shortcutId: 'quickadd.open' }),
      cmd('c.new', 'new task', 'Create'),
      cmd('d.other', 'New task', 'Help'), // another group: a different command
    ]
    const groups = build({ commands, query: 'new task' })
    const listed = groups.flatMap((g) => g.items)
    expect(listed.map((i) => (i.action.type === 'command' ? i.action.command.id : ''))).toEqual([
      'b.new',
      'd.other',
    ])
    expect(listed[0]?.shortcut).toBe('q')
  })

  it('is empty when nothing matches', () => {
    expect(build({ query: 'zzqx', providers: [TASKS] })).toEqual([
      expect.objectContaining({ heading: 'Tasks' }),
    ])
    expect(build({ query: 'zzqx' })).toEqual([])
  })
})

describe('rankResults', () => {
  it('puts title matches first (best first), then subtitle matches, then the provider order', () => {
    const list = [
      result('a', 'Outline essay'),
      result('b', 'Quiz', 'C182 chapter 4'),
      result('c', 'Read chapter 4'),
      result('d', 'Chapter 4 recap'),
    ]
    const ranked = rankResults(list, 'chapter')
    expect(ranked.map((r) => r.item.id)).toEqual(['d', 'c', 'b', 'a'])
    expect(ranked[0]?.matches?.length).toBe(7)
    expect(ranked[2]?.subtitleMatches?.length).toBe(7)
    expect(ranked[3]?.matches).toBeUndefined()
  })

  it('finds a task by a fuzzy query', () => {
    const ranked = rankResults(TASKS.results, 'rdch4')
    expect(ranked[0]?.item.id).toBe('t1')
    expect(ranked[0]?.matches).toBeDefined()
  })
})

describe('indexItems', () => {
  it('maps ids back to items', () => {
    const groups = build({ query: 'read', providers: [TASKS] })
    const index = indexItems(groups)
    const first = groups[0]?.items[0]
    expect(first && index.get(first.id)).toBe(first)
    expect(index.get('nope')).toBeUndefined()
  })
})
