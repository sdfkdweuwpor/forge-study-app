import { describe, expect, it } from 'vitest'
import type { RecurrenceRule, Task } from '@/db/types'
import { buildNextInstance, nextDueAfterCompletion } from './taskFlow'

const daily: RecurrenceRule = { freq: 'daily', interval: 1, byWeekday: [] }
const sundays: RecurrenceRule = { freq: 'weekly', interval: 1, byWeekday: [0] }
const weekdays: RecurrenceRule = { freq: 'weekdays', interval: 1, byWeekday: [] }
const fortnightly: RecurrenceRule = { freq: 'weekly', interval: 2, byWeekday: [1] }

describe('nextDueAfterCompletion', () => {
  it('advances one occurrence from the due date when finished on time', () => {
    expect(nextDueAfterCompletion(daily, '2026-09-29', '2026-09-29')).toBe('2026-09-30')
    expect(nextDueAfterCompletion(sundays, '2026-09-27', '2026-09-27')).toBe('2026-10-04')
  })

  it('skips occurrences that are already in the past when finished late', () => {
    // A daily task due Sept 26, finished Sept 29: next is tomorrow, not Sept 27.
    expect(nextDueAfterCompletion(daily, '2026-09-26', '2026-09-29')).toBe('2026-09-30')
    // Weekly on Sundays, due Sept 20, finished on Tuesday Sept 29: next Sunday.
    expect(nextDueAfterCompletion(sundays, '2026-09-20', '2026-09-29')).toBe('2026-10-04')
  })

  it('keeps the phase of an every-other-week series when finished late', () => {
    // Mondays every 2 weeks: Sept 7, Sept 21, Oct 5 …; finished Sept 29 -> Oct 5.
    expect(nextDueAfterCompletion(fortnightly, '2026-09-07', '2026-09-29')).toBe('2026-10-05')
  })

  it('goes after the due date when finished early', () => {
    expect(nextDueAfterCompletion(daily, '2026-10-05', '2026-09-29')).toBe('2026-10-06')
  })

  it('recurs from today when the task had no due date', () => {
    expect(nextDueAfterCompletion(daily, null, '2026-09-29')).toBe('2026-09-30')
    // Friday -> Monday for weekdays.
    expect(nextDueAfterCompletion(weekdays, null, '2026-10-02')).toBe('2026-10-05')
  })

  it('is always strictly after today, even for a very old due date', () => {
    const next = nextDueAfterCompletion(daily, '2020-01-01', '2026-09-29')
    expect(next).toBe('2026-09-30')
  })
})

const task = (over: Partial<Task> = {}): Task => ({
  id: 'weekly-1',
  createdAt: 100,
  updatedAt: 200,
  title: 'Weekly review',
  notes: [
    { id: 'n1', type: 'p', text: 'Wins, blockers, next week.' },
    { id: 'n2', type: 'todo', text: 'Check C779 pace', checked: true },
  ],
  status: 'done',
  priority: 2,
  dueDate: '2026-09-27',
  dueTime: '18:00',
  estimatePomodoros: 1,
  estimateMinutes: null,
  tags: ['review'],
  goalId: null,
  milestoneId: null,
  unitId: null,
  source: 'user',
  scheduleKey: 'u:1',
  schedulePinned: true,
  skippedOn: '2026-09-26',
  orderInDay: 3,
  subtasks: [
    { id: 's1', title: 'Open the planner', done: true },
    { id: 's2', title: 'Write next week', done: true },
  ],
  recurrence: sundays,
  seriesId: null,
  order: 500,
  boardOrder: 500,
  startedAt: 150,
  completedAt: 300,
  completedDay: '2026-09-27',
  ...over,
})

describe('buildNextInstance', () => {
  let n = 0
  const opts = { id: 'weekly-2', dueDate: '2026-10-04', now: 999, newId: () => `new-${++n}` }

  it('copies the content and resets progress', () => {
    const next = buildNextInstance(task(), opts)
    expect(next).toMatchObject({
      id: 'weekly-2',
      createdAt: 999,
      updatedAt: 999,
      title: 'Weekly review',
      status: 'todo',
      priority: 2,
      dueDate: '2026-10-04',
      dueTime: '18:00',
      estimatePomodoros: 1,
      tags: ['review'],
      order: 500,
      scheduleKey: null,
      schedulePinned: false,
      skippedOn: null,
      startedAt: null,
      completedAt: null,
      completedDay: null,
    })
    expect(next.recurrence).toEqual(sundays)
  })

  it('unchecks subtasks with fresh ids and unchecks todo blocks in the notes', () => {
    const next = buildNextInstance(task(), opts)
    expect(next.subtasks.map((s) => s.done)).toEqual([false, false])
    expect(next.subtasks.map((s) => s.title)).toEqual(['Open the planner', 'Write next week'])
    expect(next.subtasks.map((s) => s.id)).not.toContain('s1')
    expect(next.notes[1]).toMatchObject({ type: 'todo', checked: false })
    expect(next.notes[0]).toEqual({ id: 'n1', type: 'p', text: 'Wins, blockers, next week.' })
  })

  it('starts a series on the first repeat, and joins it afterwards', () => {
    expect(buildNextInstance(task(), opts).seriesId).toBe('weekly-1')
    expect(buildNextInstance(task({ seriesId: 'root' }), opts).seriesId).toBe('root')
  })

  it('does not share arrays with the finished task', () => {
    const source = task()
    const next = buildNextInstance(source, opts)
    next.tags.push('x')
    next.recurrence?.byWeekday.push(3)
    expect(source.tags).toEqual(['review'])
    expect(source.recurrence?.byWeekday).toEqual([0])
  })
})
