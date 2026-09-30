import { describe, expect, it } from 'vitest'
import type { Task } from '@/db/types'
import {
  completedDayLabel,
  completedDayOf,
  defaultGroupBy,
  defaultSort,
  groupCompleted,
  inList,
  isTaskListId,
  listFromParam,
  listLabel,
  tomorrowOf,
} from './taskLists'

const TODAY = '2026-09-29'

const task = (over: Partial<Task> = {}): Task => ({
  id: 't',
  createdAt: 1,
  updatedAt: 1,
  title: 'Renew library card',
  notes: [],
  status: 'todo',
  priority: 0,
  doDate: null,
  doTime: null,
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
  order: 0,
  boardOrder: 0,
  startedAt: null,
  completedAt: null,
  completedDay: null,
  durationMinutes: null,
  autoSlot: false,
  kind: 'task',
  assessmentId: null,
  sync: null,
  dueDate: null,
  dueTime: null,
  ...over,
})

describe('list ids', () => {
  it('recognise the four lists and fall back to the inbox', () => {
    expect(isTaskListId('all')).toBe(true)
    expect(isTaskListId('today')).toBe(false)
    expect(listFromParam(undefined)).toBe('inbox')
    expect(listFromParam('nope')).toBe('inbox')
    expect(listFromParam('completed')).toBe('completed')
    expect(listLabel('all')).toBe('All tasks')
  })
})

describe('inList', () => {
  const ctx = { today: TODAY }
  const personal = task()
  const chunk = task({
    source: 'schedule',
    goalId: 'g',
    milestoneId: 'm',
    doDate: '2026-09-29',
  })
  const future = task({ doDate: '2026-10-02' })
  const done = task({ status: 'done', completedAt: 5 })

  it('inbox holds open tasks that are not tied to a goal or course, dated or not', () => {
    expect(inList(personal, 'inbox', ctx)).toBe(true)
    expect(inList(future, 'inbox', ctx)).toBe(true)
    expect(inList(chunk, 'inbox', ctx)).toBe(false)
    expect(inList(task({ milestoneId: 'm' }), 'inbox', ctx)).toBe(false)
    expect(inList(done, 'inbox', ctx)).toBe(false)
  })

  it('upcoming holds open tasks due after today', () => {
    expect(inList(future, 'upcoming', ctx)).toBe(true)
    expect(inList(task({ doDate: TODAY }), 'upcoming', ctx)).toBe(false)
    expect(inList(task({ doDate: '2026-09-20' }), 'upcoming', ctx)).toBe(false)
    expect(inList(personal, 'upcoming', ctx)).toBe(false)
    expect(inList(task({ doDate: '2026-10-02', status: 'done' }), 'upcoming', ctx)).toBe(false)
  })

  it('all holds every open task, including doing', () => {
    expect(inList(chunk, 'all', ctx)).toBe(true)
    expect(inList(task({ status: 'doing' }), 'all', ctx)).toBe(true)
    expect(inList(done, 'all', ctx)).toBe(false)
  })

  it('completed holds only finished tasks', () => {
    expect(inList(done, 'completed', ctx)).toBe(true)
    expect(inList(personal, 'completed', ctx)).toBe(false)
  })
})

describe('defaults', () => {
  it('group by date except for the completed list', () => {
    expect(defaultGroupBy('inbox')).toBe('date')
    expect(defaultGroupBy('all')).toBe('date')
    expect(defaultGroupBy('completed')).toBe('none')
  })

  it('sort manually, but upcoming by due date', () => {
    expect(defaultSort('inbox')).toEqual({ key: 'manual', dir: 'asc' })
    expect(defaultSort('upcoming')).toEqual({ key: 'due', dir: 'asc' })
  })

  it('tomorrowOf crosses month ends', () => {
    expect(tomorrowOf('2026-09-30')).toBe('2026-10-01')
  })
})

describe('completed grouping', () => {
  it('reads the completion day, falling back to the day of completedAt', () => {
    expect(completedDayOf(task({ completedDay: '2026-09-25' }))).toBe('2026-09-25')
    // 2026-09-27 12:00 local, so any timezone lands on the 27th.
    const noon = new Date(2026, 8, 27, 12).getTime()
    expect(completedDayOf(task({ completedAt: noon }))).toBe('2026-09-27')
    expect(completedDayOf(task())).toBeNull()
  })

  it('labels days relative to today', () => {
    expect(completedDayLabel('2026-09-29', TODAY)).toBe('Today')
    expect(completedDayLabel('2026-09-28', TODAY)).toBe('Yesterday')
    expect(completedDayLabel('2026-09-25', TODAY)).toBe('Fri, Sep 25')
    expect(completedDayLabel('2025-12-31', TODAY)).toBe('Wed, Dec 31, 2025')
  })

  it('groups by day, newest day first and newest task first, and never drops a task', () => {
    const a = task({ id: 'a', status: 'done', completedDay: '2026-09-27', completedAt: 100 })
    const b = task({ id: 'b', status: 'done', completedDay: '2026-09-29', completedAt: 300 })
    const c = task({ id: 'c', status: 'done', completedDay: '2026-09-27', completedAt: 200 })
    const orphan = task({ id: 'd', status: 'done' })
    const groups = groupCompleted([a, b, c, orphan], { today: TODAY })
    expect(groups.map((g) => g.id)).toEqual(['day:2026-09-29', 'day:2026-09-27'])
    expect(groups[0]?.label).toBe('Today')
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(['b', 'd'])
    expect(groups[1]?.tasks.map((t) => t.id)).toEqual(['c', 'a'])
    expect(groups.flatMap((g) => g.tasks)).toHaveLength(4)
  })

  it('returns no groups for no tasks', () => {
    expect(groupCompleted([], { today: TODAY })).toEqual([])
  })
})
