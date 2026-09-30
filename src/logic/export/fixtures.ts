import type { Block, Task } from '@/db/types'

/** A plain task with every field set; override what a test cares about. */
export function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    createdAt: 0,
    updatedAt: 0,
    title: 'Read chapter 4',
    notes: [],
    status: 'todo',
    priority: 0,
    doDate: null,
    doTime: null,
    durationMinutes: null,
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
    order: 1,
    boardOrder: 1,
    startedAt: null,
    completedAt: null,
    completedDay: null,
    autoSlot: false,
    kind: 'task',
    assessmentId: null,
    sync: null,
    ...over,
  }
}

export function para(id: string, text: string): Block {
  return { id, type: 'p', text }
}
