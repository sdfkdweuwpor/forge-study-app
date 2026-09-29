import { describe, expect, it } from 'vitest'
import {
  activeFilterCount,
  canReorder,
  clearFilters,
  isDefaultView,
  viewFromQuery,
  viewToQuery,
} from './taskListView'

describe('viewFromQuery', () => {
  it('gives the list defaults for an empty query', () => {
    expect(viewFromQuery('inbox', {})).toEqual({
      groupBy: 'date',
      sort: { key: 'manual', dir: 'asc' },
      filter: {},
    })
    expect(viewFromQuery('upcoming', {}).sort).toEqual({ key: 'due', dir: 'asc' })
    expect(viewFromQuery('completed', {}).groupBy).toBe('none')
  })

  it('reads grouping, sort, direction and every filter', () => {
    const view = viewFromQuery('all', {
      group: 'project',
      sort: 'priority',
      dir: 'desc',
      status: 'todo,doing',
      priority: '3,4',
      tag: 'C779,mentor',
      course: 'course-c779',
      due: 'week',
    })
    expect(view).toEqual({
      groupBy: 'project',
      sort: { key: 'priority', dir: 'desc' },
      filter: {
        status: ['todo', 'doing'],
        priority: [3, 4],
        tags: ['C779', 'mentor'],
        milestoneIds: ['course-c779'],
        due: 'week',
      },
    })
  })

  it('ignores unknown and malformed values', () => {
    const view = viewFromQuery('all', {
      group: 'sideways',
      sort: 'vibes',
      dir: 'up',
      status: 'todo,archived,todo',
      priority: '2,9,x,-1,2.5,4',
      due: 'someday',
      tag: ' , ',
    })
    expect(view).toEqual({
      groupBy: 'date',
      sort: { key: 'manual', dir: 'asc' },
      filter: { status: ['todo'], priority: [2, 4] },
    })
  })

  it('a direction alone keeps the default sort key, and a new key starts ascending', () => {
    expect(viewFromQuery('upcoming', { dir: 'desc' }).sort).toEqual({ key: 'due', dir: 'desc' })
    expect(viewFromQuery('inbox', { sort: 'title' }).sort).toEqual({ key: 'title', dir: 'asc' })
  })
})

describe('viewToQuery', () => {
  it('is all undefined for a default view, so setQuery clears stale keys', () => {
    const q = viewToQuery('inbox', viewFromQuery('inbox', {}))
    expect(Object.keys(q).sort()).toEqual([
      'course',
      'dir',
      'due',
      'group',
      'priority',
      'sort',
      'status',
      'tag',
    ])
    expect(Object.values(q).every((v) => v === undefined)).toBe(true)
  })

  it('round-trips a customised view', () => {
    const original = {
      group: 'project',
      sort: 'due',
      dir: 'desc',
      status: 'todo',
      priority: '4',
      tag: 'finance',
      course: 'course-c779,course-d278',
      due: 'overdue',
    }
    const view = viewFromQuery('inbox', original)
    const back = viewToQuery('inbox', view)
    expect(back).toEqual(original)
    expect(viewFromQuery('inbox', back as Record<string, string>)).toEqual(view)
  })

  it('omits what matches the list default, per list', () => {
    // Upcoming sorts by due date by default, so `sort=due` is not written there.
    const upcoming = viewToQuery('upcoming', viewFromQuery('upcoming', { sort: 'due' }))
    expect(upcoming.sort).toBeUndefined()
    expect(viewToQuery('inbox', viewFromQuery('inbox', { sort: 'due' })).sort).toBe('due')
  })
})

describe('helpers', () => {
  it('counts each active filter kind once', () => {
    expect(activeFilterCount({})).toBe(0)
    expect(activeFilterCount({ priority: [3, 4], tags: ['a', 'b'], due: 'any' })).toBe(2)
    expect(activeFilterCount({ status: ['todo'], milestoneIds: ['m'], due: 'today' })).toBe(3)
    expect(activeFilterCount({ tags: [] })).toBe(0)
  })

  it('clearFilters keeps grouping and sort', () => {
    const view = viewFromQuery('all', { group: 'project', sort: 'title', priority: '4' })
    expect(clearFilters(view)).toEqual({
      groupBy: 'project',
      sort: { key: 'title', dir: 'asc' },
      filter: {},
    })
  })

  it('isDefaultView is false as soon as anything differs', () => {
    expect(isDefaultView('all', viewFromQuery('all', {}))).toBe(true)
    expect(isDefaultView('all', viewFromQuery('all', { priority: '4' }))).toBe(false)
    expect(isDefaultView('all', viewFromQuery('all', { group: 'none' }))).toBe(false)
  })

  it('allows dragging only in ascending manual order outside Completed', () => {
    expect(canReorder('inbox', viewFromQuery('inbox', {}))).toBe(true)
    expect(canReorder('inbox', viewFromQuery('inbox', { sort: 'due' }))).toBe(false)
    expect(canReorder('inbox', viewFromQuery('inbox', { dir: 'desc' }))).toBe(false)
    expect(canReorder('upcoming', viewFromQuery('upcoming', {}))).toBe(false)
    expect(canReorder('completed', viewFromQuery('completed', { sort: 'manual' }))).toBe(false)
  })
})
