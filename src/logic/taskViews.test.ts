import { describe, expect, it } from 'vitest'
import type { SavedView } from '@/db/types'
import { viewFromQuery, type TaskListView } from './taskListView'
import {
  canSaveView,
  layoutFromQuery,
  layoutsFor,
  normalizeFilter,
  parseLayoutPrefs,
  resetViewQuery,
  resolveLayout,
  sameView,
  savedViewQuery,
  savedViewState,
  savedViewToView,
  saveViewNote,
  serializeLayoutPrefs,
  suggestViewName,
  viewToSave,
} from './taskViews'

const saved: Pick<SavedView, 'filter' | 'sort' | 'groupBy' | 'layout'> = {
  filter: { priority: [3, 4], milestoneIds: ['course-c779'] },
  sort: { key: 'due', dir: 'asc' },
  groupBy: 'project',
  layout: 'board',
}

describe('layouts', () => {
  it('reads only known layouts from the address bar', () => {
    expect(layoutFromQuery('board')).toBe('board')
    expect(layoutFromQuery('calendar')).toBe('calendar')
    expect(layoutFromQuery('grid')).toBeUndefined()
    expect(layoutFromQuery(undefined)).toBeUndefined()
  })

  it('gives Completed the list layout only', () => {
    expect(layoutsFor('completed')).toEqual(['list'])
    expect(layoutsFor('inbox')).toEqual(['list', 'board', 'calendar'])
  })

  it('resolves address bar, then the remembered layout, then list', () => {
    const prefs = { inbox: 'board', all: 'calendar' } as const
    expect(resolveLayout('inbox', 'calendar', prefs)).toBe('calendar')
    expect(resolveLayout('inbox', undefined, prefs)).toBe('board')
    expect(resolveLayout('upcoming', undefined, prefs)).toBe('list')
    expect(resolveLayout('inbox', 'nonsense', prefs)).toBe('board')
  })

  it('never resolves a layout the list does not have', () => {
    expect(resolveLayout('completed', 'board', { completed: 'calendar' })).toBe('list')
  })

  it('round-trips the remembered layouts and drops anything malformed', () => {
    const prefs = { inbox: 'board', upcoming: 'list' } as const
    expect(parseLayoutPrefs(serializeLayoutPrefs(prefs))).toEqual(prefs)
    expect(parseLayoutPrefs(null)).toEqual({})
    expect(parseLayoutPrefs('board')).toEqual({})
    expect(parseLayoutPrefs('[1,2]')).toEqual({})
    expect(parseLayoutPrefs('{"inbox":"grid","nope":"board","all":"calendar"}')).toEqual({
      all: 'calendar',
    })
  })
})

describe('sameView / normalizeFilter', () => {
  it('ignores no-op filter keys and the direction of a manual sort', () => {
    expect(normalizeFilter({ priority: [], tags: [], due: 'any', text: '  ' })).toEqual({})
    expect(
      sameView(
        { groupBy: 'date', sort: { key: 'manual', dir: 'desc' }, filter: { status: [] } },
        { groupBy: 'date', sort: { key: 'manual', dir: 'asc' }, filter: {} },
      ),
    ).toBe(true)
  })

  it('treats different filters, sorts and groupings as different', () => {
    const base = { groupBy: 'date', sort: { key: 'manual', dir: 'asc' }, filter: {} } as const
    expect(sameView(base, { ...base, groupBy: 'project' })).toBe(false)
    expect(sameView(base, { ...base, sort: { key: 'due', dir: 'asc' } })).toBe(false)
    expect(sameView(base, { ...base, filter: { priority: [3] } })).toBe(false)
  })

  it('compares priorities and statuses regardless of order', () => {
    expect(
      sameView(
        { groupBy: 'date', sort: { key: 'manual', dir: 'asc' }, filter: { priority: [4, 3] } },
        { groupBy: 'date', sort: { key: 'manual', dir: 'asc' }, filter: { priority: [3, 4] } },
      ),
    ).toBe(true)
  })
})

describe('saved views in the address bar', () => {
  it('shows the stored view and layout when the address is clean', () => {
    const state = savedViewState(saved, {})
    expect(state.view).toEqual(savedViewToView(saved))
    expect(state.layout).toBe('board')
    expect(state.modified).toBe(false)
  })

  it('a layout in the address bar overrides the stored one and counts as a change', () => {
    const state = savedViewState(saved, { layout: 'calendar' })
    expect(state.layout).toBe('calendar')
    expect(state.modified).toBe(true)
    expect(state.view).toEqual(savedViewToView(saved))
  })

  it('reads the edits written behind mod=1, in full', () => {
    const edited = { ...savedViewToView(saved), groupBy: 'date' as const }
    const query = savedViewQuery(saved, edited, 'board')
    expect(query.mod).toBe('1')
    const state = savedViewState(saved, query)
    expect(state.view).toEqual(edited)
    expect(state.modified).toBe(true)
  })

  it('keeps the stored filter in the address when only the grouping is edited', () => {
    const edited = { ...savedViewToView(saved), groupBy: 'none' as const }
    const query = savedViewQuery(saved, edited, 'board')
    const roundTrip = viewFromQuery('all', query as Record<string, string | undefined>)
    expect(roundTrip.filter).toEqual(saved.filter)
    expect(roundTrip.groupBy).toBe('none')
  })

  it('clearing every filter of a saved view is an edit, not a return to the stored view', () => {
    const edited = { groupBy: 'date', sort: { key: 'manual', dir: 'asc' }, filter: {} } as const
    const query = savedViewQuery(saved, edited, 'board')
    expect(query.mod).toBe('1')
    const state = savedViewState(saved, query)
    expect(state.view.filter).toEqual({})
    expect(state.modified).toBe(true)
  })

  it('an edit equal to the stored view writes a clean address', () => {
    const query = savedViewQuery(saved, savedViewToView(saved), 'board')
    expect(Object.values(query).every((v) => v === undefined)).toBe(true)
    expect(savedViewState(saved, query).modified).toBe(false)
  })

  it('reset removes every view key', () => {
    expect(Object.values(resetViewQuery()).every((v) => v === undefined)).toBe(true)
    expect(Object.keys(resetViewQuery())).toEqual(
      expect.arrayContaining([
        'group',
        'sort',
        'dir',
        'status',
        'priority',
        'tag',
        'course',
        'due',
        'mod',
        'layout',
      ]),
    )
  })
})

describe('viewToSave', () => {
  it('folds Upcoming into the filter, unless a date filter is already on', () => {
    const view: TaskListView = {
      groupBy: 'date',
      sort: { key: 'due', dir: 'asc' },
      filter: { priority: [3] },
    }
    expect(viewToSave('upcoming', view).filter).toEqual({ priority: [3], due: 'upcoming' })
    expect(viewToSave('upcoming', { ...view, filter: { due: 'week' } }).filter).toEqual({
      due: 'week',
    })
    expect(viewToSave('all', view).filter).toEqual({ priority: [3] })
  })
})

describe('canSaveView / saveViewNote', () => {
  it('Completed cannot be saved, every open-task list can', () => {
    expect(canSaveView('completed')).toBe(false)
    for (const list of ['inbox', 'upcoming', 'all'] as const) expect(canSaveView(list)).toBe(true)
  })

  it('says that a saved view covers all open tasks, and what happens to Inbox and Upcoming', () => {
    expect(saveViewNote('all')).toContain('all your open tasks')
    expect(saveViewNote('inbox')).toContain('not tied to a goal')
    expect(saveViewNote('inbox')).toContain('not kept')
    expect(saveViewNote('upcoming')).toContain('due later than today')
  })
})

describe('suggestViewName', () => {
  it('names a view after its filter', () => {
    const sort = { key: 'manual', dir: 'asc' } as const
    expect(suggestViewName({ groupBy: 'date', sort, filter: { priority: [3, 4] } })).toBe(
      'High priority',
    )
    expect(suggestViewName({ groupBy: 'date', sort, filter: { priority: [4] } })).toBe('Urgent')
    expect(suggestViewName({ groupBy: 'date', sort, filter: { due: 'overdue' } })).toBe(
      'Carried over',
    )
    expect(
      suggestViewName(
        {
          groupBy: 'date',
          sort,
          filter: { priority: [3], milestoneIds: ['c'], tags: ['#mentor'] },
        },
        { c: 'C779 Web Development Foundations' },
      ),
    ).toBe('High priority · C779 Web Development Foundations · #mentor')
  })

  it('falls back to the sort, then to a plain name', () => {
    expect(suggestViewName({ groupBy: 'none', sort: { key: 'due', dir: 'asc' }, filter: {} })).toBe(
      'By due date',
    )
    expect(
      suggestViewName({ groupBy: 'none', sort: { key: 'manual', dir: 'asc' }, filter: {} }),
    ).toBe('My view')
  })
})
