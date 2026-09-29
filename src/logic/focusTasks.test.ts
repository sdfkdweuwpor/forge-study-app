import { describe, expect, it } from 'vitest'
import type { Task } from '@/db/types'
import { rankFocusTasks } from './focusTasks'

const TODAY = '2026-09-29'

let seq = 0
function task(overrides: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: `t${String(seq).padStart(3, '0')}`,
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

const titles = (hits: { task: Task }[]): string[] => hits.map((h) => h.task.title)

describe('rankFocusTasks with no query', () => {
  it('offers in-progress first, then due or overdue, then later, then undated', () => {
    const tasks = [
      task({ title: 'Undated' }),
      task({ title: 'Next week', dueDate: '2026-10-05' }),
      task({ title: 'Due today', dueDate: TODAY }),
      task({ title: 'Overdue', dueDate: '2026-09-27' }),
      task({ title: 'In progress', status: 'doing', dueDate: '2026-10-09' }),
    ]
    expect(titles(rankFocusTasks(tasks, '', TODAY))).toEqual([
      'In progress',
      'Overdue',
      'Due today',
      'Next week',
      'Undated',
    ])
  })

  it('never offers a finished task, and puts a task skipped today last', () => {
    const tasks = [
      task({ title: 'Skipped', dueDate: TODAY, skippedOn: TODAY }),
      task({ title: 'Done', status: 'done', dueDate: TODAY }),
      task({ title: 'Open', dueDate: TODAY }),
    ]
    expect(titles(rankFocusTasks(tasks, '', TODAY))).toEqual(['Open', 'Skipped'])
  })

  it('keeps the day order within a bucket and honours the limit', () => {
    const tasks = [
      task({ title: 'B', dueDate: TODAY, orderInDay: 2 }),
      task({ title: 'A', dueDate: TODAY, orderInDay: 1 }),
      task({ title: 'C', dueDate: TODAY, orderInDay: 3 }),
    ]
    expect(titles(rankFocusTasks(tasks, '', TODAY, 2))).toEqual(['A', 'B'])
  })
})

describe('rankFocusTasks with a query', () => {
  const tasks = [
    task({ title: 'C779 · Unit 3: CSS layout (45 min)', tags: ['C779'], dueDate: TODAY }),
    task({ title: 'D278 · Ch. 4 scripting basics', tags: ['D278'], dueDate: TODAY }),
    task({ title: 'Email mentor about term plan', dueDate: TODAY }),
    task({ title: 'Renew library card' }),
    task({ title: 'C182 · Operating systems (2/4)', tags: ['C182'], status: 'doing' }),
  ]

  it('finds a task by a word of its title', () => {
    expect(titles(rankFocusTasks(tasks, 'mentor', TODAY))).toEqual(['Email mentor about term plan'])
  })

  it('finds a task by its course code, even in another case', () => {
    expect(titles(rankFocusTasks(tasks, 'd278', TODAY))[0]).toBe('D278 · Ch. 4 scripting basics')
    expect(titles(rankFocusTasks(tasks, 'C182', TODAY))[0]).toBe('C182 · Operating systems (2/4)')
  })

  it('matches fuzzily, and reports the matched title letters for highlighting', () => {
    const hits = rankFocusTasks(tasks, 'rlc', TODAY)
    expect(titles(hits)).toEqual(['Renew library card'])
    expect(hits[0]?.matches.length).toBe(3)
  })

  it('a tag-only match has nothing to highlight in the title', () => {
    const only = [task({ title: 'Read chapter four', tags: ['C779'] })]
    const hits = rankFocusTasks(only, 'c779', TODAY)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.matches).toEqual([])
  })

  it('returns nothing when nothing matches, and never a done task', () => {
    expect(rankFocusTasks(tasks, 'zzzzq', TODAY)).toEqual([])
    const done = [task({ title: 'Mentor call', status: 'done' })]
    expect(rankFocusTasks(done, 'mentor', TODAY)).toEqual([])
  })

  it('treats a blank query as no query', () => {
    expect(rankFocusTasks(tasks, '   ', TODAY)).toHaveLength(5)
  })
})
