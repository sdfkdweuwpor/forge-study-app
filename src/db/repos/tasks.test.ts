import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { onDomainEvent, resetDomainEvents, settleDomainEvents, type DomainEvent } from '@/db/events'
import {
  addSubtask,
  completeTask,
  createTask,
  duplicateTask,
  moveSubtask,
  moveTask,
  removeSubtask,
  setTaskStatus,
  skipTask,
  toggleSubtask,
  trashTask,
  uncompleteTask,
  updateSubtask,
  updateTask,
} from '@/db/repos/tasks'
import { restoreFromTrash, TRASH_TTL_MS } from '@/db/repos/trash'
import { getXpSummary } from '@/db/repos/xp'
import type { RecurrenceRule, Task } from '@/db/types'

/** 2026-09-29 09:30 local (a Tuesday). */
const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const TODAY = '2026-09-29'

let events: DomainEvent[] = []

beforeEach(async () => {
  resetDomainEvents()
  events = []
  for (const type of [
    'task.created',
    'task.changed',
    'task.completed',
    'task.uncompleted',
    'task.deleted',
    'xp.changed',
  ] as const) {
    onDomainEvent(type, (e: DomainEvent) => void events.push(e))
  }
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

const eventTypes = (): string[] => events.map((e) => e.type)
const netXp = async (): Promise<number> =>
  (await db.xpEvents.toArray()).reduce((sum, e) => sum + e.amount, 0)

describe('createTask', () => {
  it('fills defaults, cleans the title and tags, and emits task.created after commit', async () => {
    const task = await createTask(
      { title: '  Read   chapter 4  ', tags: ['#C182', 'c182', 'reading'] },
      { now: NOW },
    )
    expect(task).toMatchObject({
      title: 'Read chapter 4',
      status: 'todo',
      priority: 0,
      doDate: null,
      tags: ['C182', 'reading'],
      source: 'user',
      order: NOW,
      boardOrder: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
    })
    expect(await db.tasks.get(task.id)).toEqual(task)
    await settleDomainEvents()
    expect(events).toEqual([{ type: 'task.created', taskId: task.id }])
  })

  it('rejects an empty title', async () => {
    await expect(createTask({ title: '   ' }, { now: NOW })).rejects.toThrow('title')
    expect(await db.tasks.count()).toBe(0)
  })

  it('anchors a recurring task with no date to its first occurrence', async () => {
    const sundays: RecurrenceRule = { freq: 'weekly', interval: 1, byWeekday: [0] }
    const task = await createTask({ title: 'Weekly review', recurrence: sundays }, { now: NOW })
    expect(task.doDate).toBe('2026-10-04')
    const daily: RecurrenceRule = { freq: 'daily', interval: 1, byWeekday: [] }
    expect(
      (await createTask({ title: 'Flashcards', recurrence: daily }, { now: NOW })).doDate,
    ).toBe(TODAY)
  })
})

describe('completeTask', () => {
  it('marks the task done and appends its XP event in the same transaction', async () => {
    const task = await createTask(
      { title: 'C779 · Unit 3: CSS layout (45 min)', priority: 3, estimatePomodoros: 2 },
      { now: NOW },
    )
    const result = await completeTask(task.id, { now: NOW + 1000 })

    // 10 + 5 × 2 pomodoros + 5 for high priority.
    expect(result.xp).toBe(25)
    expect(result.task).toMatchObject({
      status: 'done',
      completedAt: NOW + 1000,
      completedDay: TODAY,
    })
    expect(await db.tasks.get(task.id)).toMatchObject({ status: 'done', completedDay: TODAY })

    const log = await db.xpEvents.toArray()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      source: 'task',
      amount: 25,
      key: `task:${task.id}`,
      refId: task.id,
      day: TODAY,
      at: NOW + 1000,
    })

    await settleDomainEvents()
    expect(eventTypes().sort()).toEqual(['task.completed', 'task.created', 'xp.changed'])
    expect(events.find((e) => e.type === 'task.completed')).toMatchObject({ day: TODAY })
  })

  it('is idempotent: completing a done task awards nothing more', async () => {
    const task = await createTask({ title: 'Renew library card' }, { now: NOW })
    expect((await completeTask(task.id, { now: NOW })).xp).toBe(10)
    const again = await completeTask(task.id, { now: NOW + 5 })
    expect(again.xp).toBe(0)
    await again.undo()
    expect(await db.xpEvents.count()).toBe(1)
    expect(await netXp()).toBe(10)
  })

  it('does nothing for a missing task', async () => {
    const result = await completeTask('nope', { now: NOW })
    expect(result).toMatchObject({ xp: 0, task: null, next: null })
    await result.undo()
    expect(await db.xpEvents.count()).toBe(0)
  })

  it('undo reopens the task and leaves net XP at zero, keeping the log append-only', async () => {
    const task = await createTask({ title: 'Email mentor', estimatePomodoros: 1 }, { now: NOW })
    const done = await completeTask(task.id, { now: NOW + 10 })
    expect(await netXp()).toBe(15)

    await done.undo()
    const reopened = await db.tasks.get(task.id)
    expect(reopened).toMatchObject({ status: 'todo', completedAt: null, completedDay: null })
    expect(await netXp()).toBe(0)

    const log = await db.xpEvents.toArray()
    expect(log.map((e) => e.amount).sort((a, b) => a - b)).toEqual([-15, 15])
    expect(new Set(log.map((e) => e.key)).size).toBe(1)
    // The reversal is filed under the day of the award, so that day nets out.
    expect(log.every((e) => e.day === TODAY)).toBe(true)

    await settleDomainEvents()
    expect(eventTypes()).toContain('task.uncompleted')
  })

  it('undo puts a doing task back to doing, with the time it started', async () => {
    const task = await createTask({ title: 'Read chapter 4', status: 'doing' }, { now: NOW })
    expect(task.startedAt).toBe(NOW)
    const result = await completeTask(task.id, { now: NOW + 60_000 })
    expect(await db.tasks.get(task.id)).toMatchObject({ status: 'done', startedAt: NOW })
    await result.undo()
    expect(await db.tasks.get(task.id)).toMatchObject({
      status: 'doing',
      startedAt: NOW,
      completedAt: null,
      completedDay: null,
    })
    expect(await netXp()).toBe(0)
  })

  it('undo puts a todo task back to todo with no start time', async () => {
    const task = await createTask({ title: 'Renew library card' }, { now: NOW })
    const result = await completeTask(task.id, { now: NOW })
    await result.undo()
    expect(await db.tasks.get(task.id)).toMatchObject({ status: 'todo', startedAt: null })
  })

  it('awards again when a reopened task is completed a second time', async () => {
    const task = await createTask({ title: 'Renew library card' }, { now: NOW })
    const first = await completeTask(task.id, { now: NOW })
    await first.undo()
    const second = await completeTask(task.id, { now: NOW + 100 })
    expect(second.xp).toBe(10)
    expect(await netXp()).toBe(10)
    expect(await db.xpEvents.count()).toBe(3)
  })

  it('does not create a next instance for a plain task', async () => {
    const task = await createTask({ title: 'One-off' }, { now: NOW })
    const result = await completeTask(task.id, { now: NOW })
    expect(result.next).toBeNull()
    expect(await db.tasks.count()).toBe(1)
  })
})

describe('recurring tasks', () => {
  const sundays: RecurrenceRule = { freq: 'weekly', interval: 1, byWeekday: [0] }

  async function weekly() {
    return createTask(
      {
        title: 'Weekly review',
        recurrence: sundays,
        doDate: '2026-09-27',
        doTime: '18:00',
        priority: 2,
        tags: ['review'],
        subtasks: [{ id: 's1', title: 'Check C779 pace', done: false }],
      },
      { now: NOW },
    )
  }

  it('completing creates the next instance on the next occurrence', async () => {
    const task = await weekly()
    const result = await completeTask(task.id, { now: NOW })

    expect(result.next).toMatchObject({
      title: 'Weekly review',
      status: 'todo',
      doDate: '2026-10-04',
      doTime: '18:00',
      priority: 2,
      tags: ['review'],
      seriesId: task.id,
      completedAt: null,
    })
    expect(result.next?.subtasks.map((s) => s.done)).toEqual([false])
    expect(result.next?.subtasks[0]?.id).not.toBe('s1')
    expect(await db.tasks.count()).toBe(2)
    expect((await db.tasks.get(task.id))?.seriesId).toBe(task.id)
    await settleDomainEvents()
    expect(eventTypes().sort()).toEqual([
      'task.completed',
      'task.created',
      'task.created',
      'xp.changed',
    ])
  })

  it('undo removes the instance it created and nets XP to zero', async () => {
    const task = await weekly()
    const result = await completeTask(task.id, { now: NOW })
    await result.undo()
    expect(await db.tasks.count()).toBe(1)
    expect(await db.tasks.get(task.id)).toMatchObject({ status: 'todo' })
    expect(await netXp()).toBe(0)
  })

  it('uncompleteTask removes an untouched generated instance, but keeps an edited one', async () => {
    const a = await weekly()
    await completeTask(a.id, { now: NOW })
    const removed = await uncompleteTask(a.id, { now: NOW })
    expect(removed.xp).toBe(-10)
    expect(await db.tasks.count()).toBe(1)

    // Complete again, edit the new instance, then reopen the first: the edited one stays.
    const again = await completeTask(a.id, { now: NOW + 10 })
    const generated = again.next
    expect(generated).not.toBeNull()
    await updateTask(generated?.id ?? '', { priority: 4 }, { now: NOW + 20 })
    await db.tasks.update(generated?.id ?? '', { updatedAt: NOW + 1_000 })
    await uncompleteTask(a.id, { now: NOW + 30 })
    expect(await db.tasks.count()).toBe(2)
  })

  it('completing again does not stack a duplicate on an edited generated instance', async () => {
    const a = await weekly()
    const first = await completeTask(a.id, { now: NOW })
    const generated = first.next
    expect(generated?.doDate).toBe('2026-10-04')
    // Edit the generated instance so reopening keeps it, then reopen and finish the first one again.
    await updateTask(generated?.id ?? '', { priority: 4 }, { now: NOW + 20 })
    await db.tasks.update(generated?.id ?? '', { updatedAt: NOW + 1_000 })
    await uncompleteTask(a.id, { now: NOW + 30 })
    const again = await completeTask(a.id, { now: NOW + 40 })
    expect(again.next).toBeNull()
    const open = (await db.tasks.toArray()).filter((t) => t.status !== 'done')
    expect(open.filter((t) => t.doDate === '2026-10-04')).toHaveLength(1)
    // Undoing that second completion has nothing generated to remove: the edited one is still there.
    await again.undo()
    expect(await db.tasks.get(generated?.id ?? '')).toMatchObject({ priority: 4 })
  })

  it('undo moves an edited generated instance to the trash instead of deleting it', async () => {
    const a = await weekly()
    const result = await completeTask(a.id, { now: NOW })
    const generatedId = result.next?.id ?? ''
    await updateTask(generatedId, { priority: 4 }, { now: NOW + 20 })
    await db.tasks.update(generatedId, { updatedAt: NOW + 1_000 })
    await result.undo()
    expect(await db.tasks.get(generatedId)).toBeUndefined()
    const trashed = await db.trash.toArray()
    expect(trashed).toHaveLength(1)
    expect(trashed[0]).toMatchObject({ entityTable: 'tasks', entityId: generatedId })
    // It comes back with its edit.
    await restoreFromTrash(trashed[0]?.id ?? '')
    expect(await db.tasks.get(generatedId)).toMatchObject({ priority: 4 })
  })

  it('a task finished days late is next due after today, not in the past', async () => {
    const daily: RecurrenceRule = { freq: 'daily', interval: 1, byWeekday: [] }
    const task = await createTask(
      { title: 'Flashcards', recurrence: daily, doDate: '2026-09-25' },
      { now: NOW },
    )
    const result = await completeTask(task.id, { now: NOW })
    expect(result.next?.doDate).toBe('2026-09-30')
  })
})

describe('updateTask', () => {
  it('changes only what differs, and undo puts those fields back', async () => {
    const task = await createTask({ title: 'Read chapter 4', priority: 1 }, { now: NOW })
    const result = await updateTask(task.id, {
      priority: 3,
      doDate: '2026-09-30',
      title: 'Read chapter 4',
    })
    expect(result?.task).toMatchObject({ priority: 3, doDate: '2026-09-30' })
    await result?.undo()
    expect(await db.tasks.get(task.id)).toMatchObject({
      priority: 1,
      doDate: null,
      title: 'Read chapter 4',
    })
  })

  it('writes nothing for a patch that changes nothing', async () => {
    const task = await createTask({ title: 'Renew library card', priority: 2 }, { now: NOW })
    await settleDomainEvents()
    events = []
    const result = await updateTask(task.id, { priority: 2 })
    await settleDomainEvents()
    expect(result?.task.updatedAt).toBe(task.updatedAt)
    expect(events).toEqual([])
  })

  it('ignores an empty title, cleans tags, and returns null for a missing task', async () => {
    const task = await createTask({ title: 'Renew library card' }, { now: NOW })
    const result = await updateTask(task.id, { title: '   ', tags: ['#errands', 'Errands'] })
    expect(result?.task).toMatchObject({ title: 'Renew library card', tags: ['errands'] })
    expect(await updateTask('nope', { priority: 1 })).toBeNull()
  })

  it('anchors a rule set on a task with no date', async () => {
    const task = await createTask({ title: 'Weekly review' }, { now: NOW })
    const result = await updateTask(
      task.id,
      { recurrence: { freq: 'weekly', interval: 1, byWeekday: [0] } },
      { now: NOW },
    )
    expect(result?.task.doDate).toBe('2026-10-04')
  })

  it('pins a scheduled task when its date changes, but not for other edits', async () => {
    const chunk = await createTask(
      {
        title: 'C779 · Unit 3: CSS layout (45 min)',
        source: 'schedule',
        doDate: TODAY,
        scheduleKey: 'u3:1',
      },
      { now: NOW },
    )
    expect((await updateTask(chunk.id, { priority: 2 }))?.task.schedulePinned).toBe(false)
    const moved = await updateTask(chunk.id, { doDate: '2026-10-02' })
    expect(moved?.task.schedulePinned).toBe(true)
    await moved?.undo()
    expect(await db.tasks.get(chunk.id)).toMatchObject({ doDate: TODAY, schedulePinned: false })
  })
})

describe('do dates and deadlines (schema v2)', () => {
  it('creates a task with a deadline and no do date, with the v2 defaults', async () => {
    const task = await createTask(
      { title: 'Pay phone bill', dueDate: '2026-10-02', dueTime: '17:00' },
      { now: NOW },
    )
    expect(task).toMatchObject({
      doDate: null,
      doTime: null,
      dueDate: '2026-10-02',
      dueTime: '17:00',
      durationMinutes: null,
      autoSlot: false,
      kind: 'task',
      assessmentId: null,
      sync: null,
    })
    const chunk = await createTask(
      { title: 'C779 · Unit 3', source: 'schedule', scheduleKey: 'u3:1' },
      { now: NOW },
    )
    expect(chunk.kind).toBe('study')
  })

  it('a deadline edit never pins a scheduled task; a do-date edit does', async () => {
    const chunk = await createTask(
      { title: 'Review for OA', source: 'schedule', doDate: TODAY, scheduleKey: 'review:a:1' },
      { now: NOW },
    )
    expect((await updateTask(chunk.id, { dueDate: '2026-10-05' }))?.task.schedulePinned).toBe(false)
    expect((await updateTask(chunk.id, { doTime: '19:00' }))?.task.schedulePinned).toBe(true)
  })

  it('moving a task changes when to do it, never its deadline', async () => {
    const task = await createTask(
      { title: 'Pay tuition', doDate: TODAY, dueDate: '2026-10-08' },
      { now: NOW },
    )
    const moved = await moveTask(task.id, { doDate: '2026-10-01', doTime: '09:00' })
    expect(moved?.task).toMatchObject({
      doDate: '2026-10-01',
      doTime: '09:00',
      dueDate: '2026-10-08',
    })
  })

  it('the next instance of a recurring task keeps its deadline the same distance away', async () => {
    const weekly: RecurrenceRule = { freq: 'weekly', interval: 1, byWeekday: [2] }
    const task = await createTask(
      { title: 'Timesheet', recurrence: weekly, doDate: TODAY, dueDate: '2026-10-01' },
      { now: NOW },
    )
    const result = await completeTask(task.id, { now: NOW })
    expect(result.next).toMatchObject({ doDate: '2026-10-06', dueDate: '2026-10-08' })
  })

  it('skipping a recurring task moves its do date and its deadline together', async () => {
    const daily: RecurrenceRule = { freq: 'daily', interval: 1, byWeekday: [] }
    const task = await createTask(
      { title: 'Stretch', recurrence: daily, doDate: TODAY, dueDate: TODAY },
      { now: NOW },
    )
    const skipped = await skipTask(task.id, { now: NOW })
    expect(skipped?.task).toMatchObject({ doDate: '2026-09-30', dueDate: '2026-09-30' })
  })
})

describe('setTaskStatus', () => {
  it('moves between todo and doing, stamping startedAt', async () => {
    const task = await createTask({ title: 'Renew library card' }, { now: NOW })
    const started = await setTaskStatus(task.id, 'doing', { now: NOW + 5 })
    expect(await db.tasks.get(task.id)).toMatchObject({ status: 'doing', startedAt: NOW + 5 })
    await started?.undo()
    expect(await db.tasks.get(task.id)).toMatchObject({ status: 'todo', startedAt: null })
  })

  it('routes done through completeTask (XP) and back through uncompleteTask', async () => {
    const task = await createTask({ title: 'Renew library card' }, { now: NOW })
    await setTaskStatus(task.id, 'done', { now: NOW })
    expect(await netXp()).toBe(10)
    await setTaskStatus(task.id, 'doing', { now: NOW + 5 })
    expect(await db.tasks.get(task.id)).toMatchObject({ status: 'doing', completedAt: null })
    expect(await netXp()).toBe(0)
    expect(await setTaskStatus('nope', 'done')).toBeNull()
  })

  it('reopens a done task straight to doing in one step, with its XP taken back', async () => {
    const task = await createTask({ title: 'Renew library card' }, { now: NOW })
    await completeTask(task.id, { now: NOW })
    const result = await setTaskStatus(task.id, 'doing', { now: NOW + 5 })
    expect(await db.tasks.get(task.id)).toMatchObject({
      status: 'doing',
      startedAt: NOW + 5,
      completedAt: null,
      completedDay: null,
    })
    expect(await netXp()).toBe(0)
    await result?.undo()
    expect(await db.tasks.get(task.id)).toMatchObject({ status: 'done' })
    expect(await netXp()).toBe(10)
  })

  it('uncompleteTask can reopen to doing', async () => {
    const task = await createTask({ title: 'Renew library card' }, { now: NOW })
    await completeTask(task.id, { now: NOW })
    const result = await uncompleteTask(task.id, { now: NOW + 5, to: 'doing' })
    expect(result.xp).toBe(-10)
    expect(await db.tasks.get(task.id)).toMatchObject({ status: 'doing', startedAt: NOW + 5 })
  })
})

describe('skipTask', () => {
  it('hides a task for today and undo brings it back', async () => {
    const task = await createTask({ title: 'Email mentor', doDate: TODAY }, { now: NOW })
    const result = await skipTask(task.id, { now: NOW })
    expect(result?.task).toMatchObject({ skippedOn: TODAY, doDate: TODAY })
    await result?.undo()
    expect((await db.tasks.get(task.id))?.skippedOn).toBeNull()
  })

  it('moves a recurring task of your own to its next occurrence', async () => {
    const daily: RecurrenceRule = { freq: 'daily', interval: 1, byWeekday: [] }
    const task = await createTask(
      { title: 'Flashcards', recurrence: daily, doDate: TODAY },
      { now: NOW },
    )
    const result = await skipTask(task.id, { now: NOW })
    expect(result?.task.doDate).toBe('2026-09-30')
    await result?.undo()
    expect((await db.tasks.get(task.id))?.doDate).toBe(TODAY)
  })

  it('ignores done and missing tasks', async () => {
    const task = await createTask({ title: 'Renew library card' }, { now: NOW })
    await completeTask(task.id, { now: NOW })
    expect(await skipTask(task.id, { now: NOW })).toBeNull()
    expect(await skipTask('nope', { now: NOW })).toBeNull()
  })
})

describe('moveTask', () => {
  async function three() {
    const a = await createTask({ title: 'A', order: 1000 }, { now: NOW })
    const b = await createTask({ title: 'B', order: 2000 }, { now: NOW })
    const c = await createTask({ title: 'C', order: 3000 }, { now: NOW })
    return { a, b, c }
  }
  const titles = async (): Promise<string[]> =>
    (await db.tasks.orderBy('id').toArray()).sort((x, y) => x.order - y.order).map((t) => t.title)

  it('places a task between two neighbours by rewriting only its own order', async () => {
    const { a, b, c } = await three()
    const result = await moveTask(c.id, { reorder: { above: a.id, below: b.id } })
    expect(result?.task.order).toBe(1500)
    expect(await titles()).toEqual(['A', 'C', 'B'])
    expect((await db.tasks.get(a.id))?.order).toBe(1000)
    await result?.undo()
    expect(await titles()).toEqual(['A', 'B', 'C'])
  })

  it('moves to the top and to the bottom', async () => {
    const { a, b, c } = await three()
    await moveTask(c.id, { reorder: { above: null, below: a.id } })
    expect(await titles()).toEqual(['C', 'A', 'B'])
    await moveTask(c.id, { reorder: { above: b.id, below: null } })
    expect(await titles()).toEqual(['A', 'B', 'C'])
  })

  it('renumbers once when neighbours have been squeezed together', async () => {
    const a = await createTask({ title: 'A', order: 10 }, { now: NOW })
    const b = await createTask({ title: 'B', order: 10.0000001 }, { now: NOW })
    const c = await createTask({ title: 'C', order: 50 }, { now: NOW })
    await moveTask(c.id, { reorder: { above: a.id, below: b.id } })
    expect(await titles()).toEqual(['A', 'C', 'B'])
    const orders = (await db.tasks.toArray()).map((t) => t.order)
    expect(new Set(orders).size).toBe(3)
  })

  it('a renumber writes only the rows whose order changes', async () => {
    const a = await createTask({ title: 'A', order: 0 }, { now: NOW })
    const b = await createTask({ title: 'B', order: 0.0000001 }, { now: NOW })
    const c = await createTask({ title: 'C', order: 5000 }, { now: NOW })
    const d = await createTask({ title: 'D', order: 6000 }, { now: NOW })
    await moveTask(d.id, { reorder: { above: a.id, below: b.id } })
    // A already sits where the renumber puts it, so it is not rewritten and still looks untouched.
    const untouched = await db.tasks.get(a.id)
    expect(untouched?.updatedAt).toBe(untouched?.createdAt)
    expect(untouched?.order).toBe(0)
    expect(await titles()).toEqual(['A', 'D', 'B', 'C'])
    const changed = await db.tasks.get(c.id)
    expect(changed?.order).toBe(3072)
  })

  it('undo after a renumber puts the task back between its old neighbours', async () => {
    const a = await createTask({ title: 'A', order: 0 }, { now: NOW })
    const b = await createTask({ title: 'B', order: 0.0000001 }, { now: NOW })
    await createTask({ title: 'C', order: 10 }, { now: NOW })
    const d = await createTask({ title: 'D', order: 20 }, { now: NOW })
    const result = await moveTask(d.id, { reorder: { above: a.id, below: b.id } })
    expect(await titles()).toEqual(['A', 'D', 'B', 'C'])
    // D's old number (20) means nothing after the renumber; its place is "after C".
    await result?.undo()
    expect(await titles()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('undo falls back to the old number when a neighbour has been deleted', async () => {
    const { a, b, c } = await three()
    const result = await moveTask(c.id, { reorder: { above: a.id, below: b.id } })
    await db.tasks.delete(b.id)
    await result?.undo()
    expect((await db.tasks.get(c.id))?.order).toBe(3000)
  })

  it('changes the date and pins a scheduled task', async () => {
    const chunk = await createTask(
      {
        title: 'C779 · Unit 4: JavaScript basics (60 min)',
        source: 'schedule',
        doDate: TODAY,
        doTime: '10:00',
      },
      { now: NOW },
    )
    const result = await moveTask(chunk.id, { doDate: '2026-10-01', doTime: '14:00' })
    expect(result?.task).toMatchObject({
      doDate: '2026-10-01',
      doTime: '14:00',
      schedulePinned: true,
    })
    await result?.undo()
    expect(await db.tasks.get(chunk.id)).toMatchObject({ doDate: TODAY, doTime: '10:00' })
    expect(await moveTask('nope', { doDate: null })).toBeNull()
  })

  it('can clear the date', async () => {
    const task = await createTask({ title: 'Renew library card', doDate: TODAY }, { now: NOW })
    const result = await moveTask(task.id, { doDate: null })
    expect(result?.task.doDate).toBeNull()
  })

  it('can reorder a different key, such as boardOrder', async () => {
    const { a, b, c } = await three()
    await moveTask(c.id, { reorder: { above: a.id, below: b.id, key: 'boardOrder' } })
    expect((await db.tasks.get(c.id))?.boardOrder).toBe(1500)
    expect((await db.tasks.get(c.id))?.order).toBe(3000)
  })
})

describe('trashTask', () => {
  it('moves the task and its checklist to the trash for 30 days, and restore brings it back intact', async () => {
    const task = await createTask(
      {
        title: 'Renew library card',
        subtasks: [
          { id: 's1', title: 'Find the old card', done: true },
          { id: 's2', title: 'Fill in the form', done: false },
        ],
        tags: ['errands'],
        doDate: '2026-10-02',
      },
      { now: NOW },
    )
    const result = await trashTask(task.id, { now: NOW + 5 })
    expect(result).not.toBeNull()

    expect(await db.tasks.get(task.id)).toBeUndefined()
    const [item] = await db.trash.toArray()
    expect(item).toMatchObject({
      entityTable: 'tasks',
      entityId: task.id,
      title: 'Renew library card',
      expiresAt: NOW + 5 + TRASH_TTL_MS,
    })
    expect((item?.payload.tasks as Task[])[0]?.subtasks).toHaveLength(2)

    await result?.undo()
    expect(await db.tasks.get(task.id)).toEqual(task)
    expect(await db.trash.count()).toBe(0)
    await settleDomainEvents()
    expect(eventTypes()).toEqual(['task.created', 'task.deleted', 'task.changed'])
  })

  it('keeps XP when a finished task is trashed (XP events are never trashed)', async () => {
    const task = await createTask({ title: 'Renew library card' }, { now: NOW })
    await completeTask(task.id, { now: NOW })
    await trashTask(task.id, { now: NOW })
    expect(await netXp()).toBe(10)
  })

  it('returns null for a missing task, and restoring twice is harmless', async () => {
    expect(await trashTask('nope')).toBeNull()
    const task = await createTask({ title: 'Renew library card' }, { now: NOW })
    const result = await trashTask(task.id, { now: NOW })
    await restoreFromTrash(result?.trashId ?? '')
    expect(await restoreFromTrash(result?.trashId ?? '')).toBeNull()
    expect(await db.tasks.count()).toBe(1)
  })
})

describe('duplicateTask', () => {
  it('copies content just below the original, open and detached', async () => {
    const original = await createTask(
      {
        title: 'C779 · Unit 3: CSS layout (45 min)',
        source: 'schedule',
        scheduleKey: 'u3:1',
        schedulePinned: true,
        goalId: 'g',
        milestoneId: 'm',
        order: 1000,
        subtasks: [{ id: 's1', title: 'Grid', done: true }],
      },
      { now: NOW },
    )
    await createTask({ title: 'Next task', order: 2000 }, { now: NOW })
    const copy = await duplicateTask(original.id, { now: NOW + 1 })
    expect(copy).toMatchObject({
      title: original.title,
      source: 'user',
      scheduleKey: null,
      schedulePinned: false,
      goalId: 'g',
      milestoneId: 'm',
      order: 1500,
      status: 'todo',
    })
    expect(copy?.id).not.toBe(original.id)
    expect(copy?.subtasks).toEqual([{ id: expect.any(String), title: 'Grid', done: false }])
    expect(await duplicateTask('nope')).toBeNull()
  })
})

describe('subtasks', () => {
  it('adds, renames, checks, reorders and removes items, with undo for removal', async () => {
    const task = await createTask({ title: 'Prepare for the C779 OA' }, { now: NOW })
    const a = await addSubtask(task.id, '  Re-read CSS layout notes ')
    const b = await addSubtask(task.id, 'Do the practice assessment')
    const c = await addSubtask(task.id, 'Review missed items')
    expect(await addSubtask(task.id, '   ')).toBeNull()
    expect(await addSubtask('nope', 'x')).toBeNull()
    const subs = async () => (await db.tasks.get(task.id))?.subtasks ?? []
    expect((await subs()).map((s) => s.title)).toEqual([
      'Re-read CSS layout notes',
      'Do the practice assessment',
      'Review missed items',
    ])

    expect(await toggleSubtask(task.id, a?.id ?? '')).toBe(true)
    expect((await subs())[0]?.done).toBe(true)
    expect(
      await updateSubtask(task.id, b?.id ?? '', { title: 'Take the practice assessment' }),
    ).toBe(true)
    expect(await updateSubtask(task.id, b?.id ?? '', { title: '  ' })).toBe(true)
    expect((await subs())[1]?.title).toBe('Take the practice assessment')
    expect(await updateSubtask(task.id, 'nope', { done: true })).toBe(false)

    expect(await moveSubtask(task.id, c?.id ?? '', 0)).toBe(true)
    expect((await subs()).map((s) => s.id)).toEqual([c?.id, a?.id, b?.id])
    expect(await moveSubtask(task.id, c?.id ?? '', 0)).toBe(false)

    const removed = await removeSubtask(task.id, a?.id ?? '')
    expect((await subs()).map((s) => s.id)).toEqual([c?.id, b?.id])
    await removed?.undo()
    expect((await subs()).map((s) => s.id)).toEqual([c?.id, a?.id, b?.id])
    expect((await subs())[1]?.done).toBe(true)
    expect(await removeSubtask(task.id, 'nope')).toBeNull()
  })
})

describe('XP summary after completing and undoing', () => {
  it('shows lifetime, today and balance net of the reversal', async () => {
    const one = await createTask({ title: 'A', estimatePomodoros: 1 }, { now: NOW })
    const two = await createTask({ title: 'B', priority: 4 }, { now: NOW })
    await completeTask(one.id, { now: NOW })
    const done = await completeTask(two.id, { now: NOW })
    expect((await getXpSummary(TODAY)).lifetime).toBe(15 + 20)
    await done.undo()
    const summary = await getXpSummary(TODAY)
    expect(summary).toMatchObject({ lifetime: 15, balance: 15, today: 15, spent: 0 })
  })
})
