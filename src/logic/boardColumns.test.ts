// Runs with TZ=America/New_York.
import { describe, expect, it } from 'vitest'
import type { Task } from '@/db/types'
import {
  boardIds,
  boardOrderIds,
  boardReorderable,
  buildBoard,
  columnKey,
  DONE_WINDOW_DAYS,
  dropOver,
  findColumn,
  inLayoutList,
  moveByColumn,
  moveOver,
  parseColumnKey,
  placementOf,
  sameBoardIds,
  type BoardIds,
} from './boardColumns'

const TODAY = '2026-09-29'
const ctx = { today: TODAY, weekStartsOn: 1 } as const

let seq = 0
function task(overrides: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: `t${seq}`,
    createdAt: 1_000 + seq,
    updatedAt: 1_000 + seq,
    title: `Task ${seq}`,
    notes: [],
    status: 'todo',
    priority: 0,
    dueDate: null,
    dueTime: null,
    estimatePomodoros: null,
    estimateMinutes: null,
    tags: [],
    goalId: null,
    milestoneId: null,
    unitId: null,
    source: 'user',
    scheduleKey: null,
    schedulePinned: false,
    skippedOn: null,
    orderInDay: 0,
    subtasks: [],
    recurrence: null,
    seriesId: null,
    order: seq,
    boardOrder: seq,
    startedAt: null,
    completedAt: null,
    completedDay: null,
    ...overrides,
  }
}

const done = (day: string, overrides: Partial<Task> = {}): Task =>
  task({
    status: 'done',
    completedDay: day,
    completedAt: new Date(`${day}T12:00:00-04:00`).getTime(),
    ...overrides,
  })

const manual = { key: 'manual', dir: 'asc' } as const

describe('inLayoutList', () => {
  it('follows the list rule without its status test', () => {
    const own = task()
    const chunk = task({ goalId: 'g', milestoneId: 'c' })
    const later = task({ dueDate: '2026-10-02' })
    const finishedEarly = done('2026-09-28', { dueDate: '2026-10-02' })
    expect(inLayoutList(own, 'inbox', ctx)).toBe(true)
    expect(inLayoutList(chunk, 'inbox', ctx)).toBe(false)
    expect(inLayoutList(chunk, 'all', ctx)).toBe(true)
    expect(inLayoutList(later, 'upcoming', ctx)).toBe(true)
    expect(inLayoutList(task({ dueDate: TODAY }), 'upcoming', ctx)).toBe(false)
    expect(inLayoutList(finishedEarly, 'upcoming', ctx)).toBe(true)
  })
})

describe('buildBoard', () => {
  it('splits by status and orders To do and Doing by boardOrder, not by the list order', () => {
    const a = task({ order: 1, boardOrder: 30 })
    const b = task({ order: 2, boardOrder: 10 })
    const c = task({ status: 'doing', order: 3, boardOrder: 20 })
    const model = buildBoard([a, b, c], 'all', { filter: {}, sort: manual }, ctx)
    expect(model.columns.todo.map((t) => t.id)).toEqual([b.id, a.id])
    expect(model.columns.doing.map((t) => t.id)).toEqual([c.id])
    expect(model.columns.done).toEqual([])
    expect(model.total).toBe(3)
  })

  it('keeps a week of finished work in Done, newest first, and counts the rest', () => {
    const today = done(TODAY, { completedAt: 5_000 })
    const yesterday = done('2026-09-28', { completedAt: 4_000 })
    const edge = done('2026-09-23', { completedAt: 3_000 }) // 6 days ago: still inside the window
    const old = done('2026-09-22', { completedAt: 2_000 }) // 7 days ago: outside
    const model = buildBoard(
      [edge, old, yesterday, today],
      'all',
      { filter: {}, sort: manual },
      ctx,
    )
    expect(DONE_WINDOW_DAYS).toBe(7)
    expect(model.columns.done.map((t) => t.id)).toEqual([today.id, yesterday.id, edge.id])
    expect(model.olderDone).toBe(1)
  })

  it('applies the filter to every column and reports the unfiltered total', () => {
    const high = task({ priority: 3 })
    const low = task({ priority: 1 })
    const doneHigh = done(TODAY, { priority: 4 })
    const model = buildBoard(
      [high, low, doneHigh],
      'all',
      { filter: { priority: [3, 4] }, sort: manual },
      ctx,
    )
    expect(model.columns.todo.map((t) => t.id)).toEqual([high.id])
    expect(model.columns.done.map((t) => t.id)).toEqual([doneHigh.id])
    expect(model.total).toBe(3)
  })

  it('uses the view sort when it is not manual', () => {
    const a = task({ title: 'B', boardOrder: 1 })
    const b = task({ title: 'A', boardOrder: 2 })
    const model = buildBoard([a, b], 'all', { filter: {}, sort: { key: 'title', dir: 'asc' } }, ctx)
    expect(model.columns.todo.map((t) => t.title)).toEqual(['A', 'B'])
  })

  it('scopes the board to the list', () => {
    const own = task()
    const chunk = task({ goalId: 'g', milestoneId: 'c' })
    const model = buildBoard([own, chunk], 'inbox', { filter: {}, sort: manual }, ctx)
    expect(boardOrderIds(model)).toEqual([own.id])
    expect(model.total).toBe(1)
  })

  it('allows reordering only in the manual, ascending sort', () => {
    expect(boardReorderable({ key: 'manual', dir: 'asc' })).toBe(true)
    expect(boardReorderable({ key: 'manual', dir: 'desc' })).toBe(false)
    expect(boardReorderable({ key: 'due', dir: 'asc' })).toBe(false)
  })
})

const ids = (todo: string[], doing: string[], doneIds: string[]): BoardIds => ({
  todo,
  doing,
  done: doneIds,
})

describe('column keys and lookup', () => {
  it('round-trips column keys and finds the column of a card or a key', () => {
    expect(parseColumnKey(columnKey('doing'))).toBe('doing')
    expect(parseColumnKey('task-1')).toBeNull()
    expect(parseColumnKey('column:nope')).toBeNull()
    const board = ids(['a', 'b'], ['c'], [])
    expect(findColumn(board, 'c')).toBe('doing')
    expect(findColumn(board, columnKey('done'))).toBe('done')
    expect(findColumn(board, 'zzz')).toBeNull()
  })

  it('reads ids from a model', () => {
    const a = task()
    const b = task({ status: 'doing' })
    const model = buildBoard([a, b], 'all', { filter: {}, sort: manual }, ctx)
    expect(boardIds(model)).toEqual({ todo: [a.id], doing: [b.id], done: [] })
  })
})

describe('moveOver (dragging across columns)', () => {
  const start = ids(['a', 'b', 'c'], ['d'], [])

  it('inserts before a card of another column, or after it when below', () => {
    expect(moveOver(start, 'b', 'd', false)).toEqual(ids(['a', 'c'], ['b', 'd'], []))
    expect(moveOver(start, 'b', 'd', true)).toEqual(ids(['a', 'c'], ['d', 'b'], []))
  })

  it('appends to a column it is dragged over, empty or not', () => {
    expect(moveOver(start, 'a', columnKey('done'), false)).toEqual(ids(['b', 'c'], ['d'], ['a']))
    expect(moveOver(start, 'a', columnKey('doing'), false)).toEqual(ids(['b', 'c'], ['d', 'a'], []))
  })

  it('leaves the lists alone while the card stays in its own column', () => {
    expect(moveOver(start, 'a', 'c', false)).toBe(start)
    expect(moveOver(start, 'a', columnKey('todo'), false)).toBe(start)
  })

  it('ignores unknown ids', () => {
    expect(moveOver(start, 'nope', 'd', false)).toBe(start)
    expect(moveOver(start, 'a', 'nope', false)).toBe(start)
  })
})

describe('dropOver (dropping)', () => {
  it('reorders inside a column to the index of the card it was dropped on', () => {
    const board = ids(['a', 'b', 'c'], [], [])
    expect(dropOver(board, 'a', 'c')).toEqual(ids(['b', 'c', 'a'], [], []))
    expect(dropOver(board, 'c', 'a')).toEqual(ids(['c', 'a', 'b'], [], []))
    expect(dropOver(board, 'a', columnKey('todo'))).toEqual(ids(['b', 'c', 'a'], [], []))
  })

  it('does nothing when dropped on itself or nowhere', () => {
    const board = ids(['a', 'b'], [], [])
    expect(dropOver(board, 'a', 'a')).toBe(board)
    expect(dropOver(board, 'a', null)).toBe(board)
  })
})

describe('placementOf', () => {
  it('reports the column, index and neighbours', () => {
    const board = ids(['a', 'b', 'c'], ['d'], [])
    expect(placementOf(board, 'b')).toEqual({
      column: 'todo',
      index: 1,
      count: 3,
      above: 'a',
      below: 'c',
    })
    expect(placementOf(board, 'd')).toEqual({
      column: 'doing',
      index: 0,
      count: 1,
      above: null,
      below: null,
    })
    expect(placementOf(board, 'zzz')).toBeNull()
  })
})

describe('moveByColumn (the keyboard alternative)', () => {
  const board = ids(['a', 'b'], ['c'], [])

  it('moves a card to the end of the next or previous column', () => {
    expect(moveByColumn(board, 'a', 1)).toEqual(ids(['b'], ['c', 'a'], []))
    expect(moveByColumn(board, 'c', -1)).toEqual(ids(['a', 'b', 'c'], [], []))
  })

  it('stops at the edges', () => {
    expect(moveByColumn(board, 'a', -1)).toBeNull()
    expect(moveByColumn(ids([], [], ['z']), 'z', 1)).toBeNull()
  })

  it('compares boards', () => {
    expect(sameBoardIds(board, ids(['a', 'b'], ['c'], []))).toBe(true)
    expect(sameBoardIds(board, ids(['b', 'a'], ['c'], []))).toBe(false)
  })
})
