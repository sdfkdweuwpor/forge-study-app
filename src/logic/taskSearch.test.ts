import { describe, expect, it } from 'vitest'
import type { Block, Task } from '@/db/types'
import { searchTasksIn } from './taskSearch'

const note = (text: string): Block[] => [{ id: 'n1', type: 'p', text }]

const task = (over: Partial<Task> & { id: string; title: string }): Task => ({
  createdAt: 1,
  updatedAt: 1,
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

const tasks: Task[] = [
  task({ id: 'a', title: 'Email mentor about term plan', notes: note('Ask about D278 order') }),
  task({ id: 'b', title: 'C779 · Unit 3: CSS layout (45 min)' }),
  task({ id: 'c', title: 'Renew library card', tags: ['errands'] }),
  task({
    id: 'd',
    title: 'Prepare for the OA',
    subtasks: [{ id: 's1', title: 'Review flexbox notes', done: false }],
  }),
]

describe('searchTasksIn', () => {
  it('finds tasks by fuzzy title match, best first', () => {
    const hits = searchTasksIn(tasks, 'css lay', 10)
    expect(hits[0]?.task.id).toBe('b')
    expect(hits[0]?.in).toBe('title')
  })

  it('finds checklist items, tags and notes, saying where it matched', () => {
    expect(searchTasksIn(tasks, 'D278', 10)[0]).toMatchObject({ in: 'notes' })
    expect(searchTasksIn(tasks, 'flexbox', 10)[0]).toMatchObject({ in: 'subtask' })
    expect(searchTasksIn(tasks, 'errand', 10)[0]).toMatchObject({ in: 'tag' })
  })

  it('ranks title above notes, and open above finished at equal score', () => {
    const list = [
      task({ id: '1', title: 'Notes', notes: note('mentor call summary') }),
      task({ id: '2', title: 'Mentor intro call', status: 'done' }),
      task({ id: '3', title: 'Read the mentor guide' }),
    ]
    expect(searchTasksIn(list, 'mentor', 10).map((h) => h.task.id)).toEqual(['3', '2', '1'])
    const same = [
      task({ id: 'x', title: 'Mentor call', status: 'done' }),
      task({ id: 'y', title: 'Mentor call' }),
    ]
    expect(searchTasksIn(same, 'mentor', 10).map((h) => h.task.id)).toEqual(['y', 'x'])
  })

  it('respects the limit, and empty or hopeless queries find nothing', () => {
    expect(searchTasksIn(tasks, 'e', 2)).toHaveLength(2)
    expect(searchTasksIn(tasks, '   ', 10)).toEqual([])
    expect(searchTasksIn(tasks, 'zzzz', 10)).toEqual([])
    expect(searchTasksIn(tasks, 'e', 0)).toEqual([])
  })

  it('does not mutate its input', () => {
    const copy = [...tasks]
    searchTasksIn(tasks, 'mentor', 10)
    expect(tasks).toEqual(copy)
  })
})
