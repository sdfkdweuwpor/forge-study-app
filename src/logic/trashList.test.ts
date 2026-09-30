import { describe, expect, it } from 'vitest'
import type { TrashItem } from '@/db/types'
import {
  EMPTY_TRASH_PHRASE,
  contentsSummary,
  countContents,
  deletedLabel,
  groupTrash,
  isEmptyTrashPhrase,
  itemCount,
  matchesQuery,
  parentRefs,
  parentsNote,
  restoreNote,
  typeLabel,
  type TrashEntry,
} from './trashList'

const entry = (
  over: Partial<TrashEntry> & Pick<TrashEntry, 'id' | 'table' | 'title'>,
): TrashEntry => ({
  entityId: `${over.id}-entity`,
  deletedAt: 1000,
  expiresAt: 2000,
  contents: {},
  parents: [],
  restorable: true,
  ...over,
})

describe('typeLabel', () => {
  it('names the types the app trashes, and any other table readably', () => {
    expect(typeLabel('tasks')).toBe('Task')
    expect(typeLabel('milestones', true)).toBe('Courses')
    expect(typeLabel('units', true)).toBe('Units')
    expect(typeLabel('savedViews', true)).toBe('Views')
    expect(typeLabel('practiceQuestions', true)).toBe('Practice questions')
    expect(typeLabel('practiceQuestions')).toBe('Practice question')
  })
})

describe('parentRefs', () => {
  it('reads the goal, course and unit a task points at', () => {
    expect(parentRefs('tasks', { goalId: 'g1', milestoneId: 'm1', unitId: 'u1' })).toEqual([
      { table: 'goals', id: 'g1' },
      { table: 'milestones', id: 'm1' },
      { table: 'units', id: 'u1' },
    ])
  })

  it('skips empty links and reads a unit’s and a course’s containers', () => {
    expect(parentRefs('tasks', { goalId: null, milestoneId: '', unitId: 'u1' })).toEqual([
      { table: 'units', id: 'u1' },
    ])
    expect(parentRefs('units', { goalId: 'g1', milestoneId: 'm1' })).toHaveLength(2)
    expect(parentRefs('milestones', { goalId: 'g1' })).toEqual([{ table: 'goals', id: 'g1' }])
  })

  it('has no containers for top-level things or a non-row', () => {
    expect(parentRefs('goals', { goalId: 'g1' })).toEqual([])
    expect(parentRefs('rewards', { id: 'r1' })).toEqual([])
    expect(parentRefs('tasks', null)).toEqual([])
    expect(parentRefs('tasks', 'nope')).toEqual([])
  })
})

describe('countContents and contentsSummary', () => {
  const item = (over: Partial<TrashItem>): TrashItem => ({
    id: 't1',
    createdAt: 1,
    updatedAt: 1,
    entityTable: 'goals',
    entityId: 'g1',
    title: 'B.S. Computer Science — WGU',
    expiresAt: 2,
    payload: {},
    ...over,
  })

  it('does not count the entry’s own row', () => {
    expect(
      countContents(
        item({ payload: { goals: [{ id: 'g1' }], milestones: [{}, {}, {}], tasks: [{}, {}] } }),
      ),
    ).toEqual({ milestones: 3, tasks: 2 })
    expect(
      countContents(item({ entityTable: 'tasks', payload: { tasks: [{ id: 't1' }] } })),
    ).toEqual({})
  })

  it('reads as a list in the order courses, units, tasks…', () => {
    expect(contentsSummary({})).toBe('')
    expect(contentsSummary({ tasks: 1 })).toBe('1 task')
    expect(contentsSummary({ tasks: 61, milestones: 3 })).toBe('3 courses and 61 tasks')
    expect(contentsSummary({ tasks: 61, units: 27, milestones: 3, resources: 1 })).toBe(
      '3 courses, 27 units, 61 tasks and 1 resource',
    )
    expect(contentsSummary({ tasks: 1234 })).toBe('1,234 tasks')
    // Tables the person never sees are not listed.
    expect(contentsSummary({ readiness: 4, questionAttempts: 9 })).toBe('')
  })
})

describe('parentsNote', () => {
  it('is null when everything is still in the app', () => {
    expect(parentsNote({ table: 'tasks', parents: [], restorable: true })).toBeNull()
  })

  it('says a container in the Trash comes back too, naming the outermost one', () => {
    expect(
      parentsNote({
        table: 'tasks',
        restorable: true,
        parents: [
          {
            table: 'goals',
            id: 'g1',
            title: 'B.S. Computer Science',
            state: 'trashed',
            trashId: 'x',
          },
          {
            table: 'milestones',
            id: 'm1',
            title: 'C779 Web Development',
            state: 'trashed',
            trashId: 'x',
          },
        ],
      }),
    ).toBe('Also brings back its goal “B.S. Computer Science”, which is in the Trash.')
  })

  it('says a task comes back without a container that is gone, and a course cannot', () => {
    const gone = [{ table: 'goals' as const, id: 'g1', title: '', state: 'gone' as const }]
    expect(parentsNote({ table: 'tasks', parents: gone, restorable: true })).toBe(
      'Its goal was deleted for good, so it comes back without it.',
    )
    expect(parentsNote({ table: 'milestones', parents: gone, restorable: false })).toBe(
      'Its goal was deleted for good, so it has nowhere to come back to.',
    )
  })
})

describe('deletedLabel', () => {
  const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h, 30).getTime()

  it('says today and yesterday by calendar day, and the date otherwise', () => {
    const now = at(2026, 9, 29, 15)
    expect(deletedLabel(at(2026, 9, 29, 8), now)).toBe('Deleted today')
    expect(deletedLabel(at(2026, 9, 28, 23), now)).toBe('Deleted yesterday')
    expect(deletedLabel(at(2026, 9, 12), now)).toBe('Deleted Sep 12')
    expect(deletedLabel(at(2025, 12, 30), now)).toBe('Deleted Dec 30, 2025')
  })

  it('does not say "in the future" when the clock is behind', () => {
    expect(deletedLabel(at(2026, 9, 30), at(2026, 9, 29))).toBe('Deleted today')
  })
})

describe('restoreNote', () => {
  it('is empty for a plain restore', () => {
    expect(restoreNote([], [])).toBeUndefined()
  })

  it('names the containers that came back, and the ones left behind', () => {
    expect(restoreNote([{ entityTable: 'goals', title: 'B.S. Computer Science' }], [])).toBe(
      'Also brought back its goal “B.S. Computer Science”.',
    )
    expect(restoreNote([], ['goals'])).toBe(
      'Its goal was deleted for good, so it came back on its own.',
    )
    expect(restoreNote([], ['goals', 'milestones', 'units'])).toBe(
      'Its goal, course and unit were deleted for good, so it came back on its own.',
    )
  })
})

describe('groupTrash', () => {
  it('groups by type in a fixed order, newest first, with the plural label', () => {
    const groups = groupTrash([
      entry({ id: 'u', table: 'units', title: 'CSS layout', deletedAt: 5 }),
      entry({ id: 't1', table: 'tasks', title: 'Renew library card', deletedAt: 10 }),
      entry({ id: 'x', table: 'flashcards', title: 'What is a NIC?', deletedAt: 1 }),
      entry({ id: 'g', table: 'goals', title: 'B.S. Computer Science', deletedAt: 3 }),
      entry({ id: 't2', table: 'tasks', title: 'C182 · Unit 1 (30 min)', deletedAt: 20 }),
      entry({ id: 'c', table: 'milestones', title: 'C779 Web Development Foundations' }),
    ])
    expect(groups.map((g) => g.label)).toEqual(['Tasks', 'Goals', 'Courses', 'Units', 'Flashcards'])
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(['t2', 't1'])
  })

  it('is empty for nothing', () => {
    expect(groupTrash([])).toEqual([])
  })
})

describe('matchesQuery', () => {
  const goalEntry = entry({
    id: 'g',
    table: 'goals',
    title: 'B.S. Computer Science — WGU',
    contents: { milestones: 3, tasks: 61 },
  })
  const task = entry({
    id: 't',
    table: 'tasks',
    title: 'C182 · Unit 3: Networking (45 min)',
    parents: [{ table: 'goals', id: 'g', title: 'B.S. Computer Science', state: 'trashed' }],
  })

  it('matches everything on an empty query', () => {
    expect(matchesQuery(task, '')).toBe(true)
    expect(matchesQuery(task, '   ')).toBe(true)
  })

  it('needs every word, in any order, ignoring case', () => {
    expect(matchesQuery(task, 'c182 networking')).toBe(true)
    expect(matchesQuery(task, 'NETWORKING c182')).toBe(true)
    expect(matchesQuery(task, 'c182 hardware')).toBe(false)
  })

  it('finds by type, by contents and by the goal a task lived in', () => {
    expect(matchesQuery(goalEntry, 'goal')).toBe(true)
    expect(matchesQuery(goalEntry, '61 tasks')).toBe(true)
    expect(matchesQuery(task, 'computer science')).toBe(true)
    expect(matchesQuery(task, 'flashcards')).toBe(false)
  })
})

describe('emptying', () => {
  it('needs the words, not their case or spacing', () => {
    expect(EMPTY_TRASH_PHRASE).toBe('empty trash')
    expect(isEmptyTrashPhrase('empty trash')).toBe(true)
    expect(isEmptyTrashPhrase('  Empty   TRASH ')).toBe(true)
    expect(isEmptyTrashPhrase('empty')).toBe(false)
    expect(isEmptyTrashPhrase('')).toBe(false)
  })

  it('counts items', () => {
    expect(itemCount(1)).toBe('1 item')
    expect(itemCount(14)).toBe('14 items')
    expect(itemCount(1200)).toBe('1,200 items')
  })
})
