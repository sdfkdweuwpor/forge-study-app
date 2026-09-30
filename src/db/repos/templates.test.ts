import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { resetDomainEvents, settleDomainEvents } from '@/db/events'
import {
  applyRoutine,
  createRoutine,
  deleteRoutine,
  listRoutineRows,
  listRoutines,
  renameRoutine,
} from '@/db/repos/templates'
import { completeTask, updateTask } from '@/db/repos/tasks'
import type { Goal, Template } from '@/db/types'
import { STARTER_ROUTINES } from '@/logic/routines'

const TODAY = '2026-09-29'
const TOMORROW = '2026-09-30'
const NOW = new Date(2026, 8, 29, 8, 0).getTime()

beforeEach(async () => {
  resetDomainEvents()
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

const PAYLOAD = {
  tasks: [
    { title: 'C182 · Read Unit 3', durationMinutes: 50, doTime: '09:00' },
    { title: 'C182 · Practice questions', durationMinutes: 25 },
    { title: 'Log questions for the mentor' },
  ],
}

describe('saving routines', () => {
  it('saves a task template with a clean name and lists it', async () => {
    const { template } = await createRoutine({ name: '  Study   day ', payload: PAYLOAD }, { now: NOW })
    expect(template).toMatchObject({ kind: 'task', name: 'Study day', icon: '📋', createdAt: NOW })
    const routines = await listRoutines()
    expect(routines).toHaveLength(1)
    expect(routines[0]).toMatchObject({ name: 'Study day', builtIn: false, payload: PAYLOAD })
  })

  it('refuses a blank name or a payload that is not a routine', async () => {
    await expect(createRoutine({ name: '  ', payload: PAYLOAD })).rejects.toBeInstanceOf(RangeError)
    await expect(createRoutine({ name: 'Empty', payload: { tasks: [] } })).rejects.toBeInstanceOf(
      RangeError,
    )
    await expect(
      createRoutine({ name: 'Bad time', payload: { tasks: [{ title: 'x', doTime: '9am' }] } }),
    ).rejects.toBeInstanceOf(RangeError)
    expect(await db.templates.count()).toBe(0)
  })

  it('undo of a save deletes it', async () => {
    const made = await createRoutine({ name: 'Weekly reset', payload: PAYLOAD })
    await made.undo()
    expect(await db.templates.count()).toBe(0)
  })

  it('lists rows it cannot read, without applying them, and leaves goal templates alone', async () => {
    const broken: Template = {
      id: 'broken',
      createdAt: NOW,
      updatedAt: NOW,
      kind: 'task',
      name: 'Broken',
      icon: '📋',
      payload: { tasks: 'nope' },
    }
    const goalTemplate: Template = {
      id: 'goal-1',
      createdAt: NOW,
      updatedAt: NOW,
      kind: 'goal',
      name: 'WGU degree term',
      icon: '🎓',
      payload: {},
    }
    await db.templates.bulkAdd([broken, goalTemplate])
    const rows = await listRoutineRows()
    expect(rows.map((r) => [r.template.id, r.payload === null])).toEqual([['broken', true]])
    expect(await listRoutines()).toEqual([])
    // A broken routine can still be deleted, and undo brings it back.
    const removed = await deleteRoutine('broken')
    expect(await db.templates.get('broken')).toBeUndefined()
    await removed?.undo()
    expect(await db.templates.get('broken')).toEqual(broken)
    // A goal template is not a routine: nothing here renames or deletes it.
    expect(await deleteRoutine('goal-1')).toBeNull()
    expect(await renameRoutine('goal-1', 'Renamed')).toBeNull()
  })
})

describe('rename and delete', () => {
  it('renames with undo, and ignores a blank name', async () => {
    const { template } = await createRoutine({ name: 'Study day', payload: PAYLOAD }, { now: NOW })
    const renamed = await renameRoutine(template.id, '  Deep study day ', { now: NOW + 1 })
    expect((await db.templates.get(template.id))?.name).toBe('Deep study day')
    await renamed?.undo()
    expect((await db.templates.get(template.id))?.name).toBe('Study day')
    expect(await renameRoutine(template.id, '   ')).toBeNull()
    expect(await renameRoutine('missing', 'Anything')).toBeNull()
  })

  it('deletes with an undo that restores the exact row', async () => {
    const { template } = await createRoutine({ name: 'Study day', payload: PAYLOAD }, { now: NOW })
    const removed = await deleteRoutine(template.id)
    expect(await db.templates.count()).toBe(0)
    await removed?.undo()
    expect(await db.templates.get(template.id)).toEqual(template)
    expect(await deleteRoutine('missing')).toBeNull()
  })
})

describe('applyRoutine', () => {
  it('adds the tasks to the day, in order, with time, length and source', async () => {
    const { tasks } = await applyRoutine(PAYLOAD, TOMORROW, { now: NOW })
    expect(tasks.map((t) => t.title)).toEqual(PAYLOAD.tasks.map((t) => t.title))
    expect(tasks[0]).toMatchObject({
      doDate: TOMORROW,
      doTime: '09:00',
      durationMinutes: 50,
      source: 'template',
      status: 'todo',
    })
    expect(tasks[2]).toMatchObject({ doDate: TOMORROW, doTime: null, durationMinutes: null })
    const orders = tasks.map((t) => t.order)
    expect([...orders].sort((a, b) => a - b)).toEqual(orders)
    expect(await db.tasks.count()).toBe(3)
  })

  it('applies a built-in starter', async () => {
    const starter = STARTER_ROUTINES[1]
    if (!starter) throw new Error('missing starter')
    const { tasks } = await applyRoutine(starter.payload, TODAY, { now: NOW })
    expect(tasks).toHaveLength(starter.payload.tasks.length)
    expect(tasks.every((t) => t.doDate === TODAY)).toBe(true)
  })

  it('keeps a goal that exists and drops one that does not', async () => {
    const goal = { id: 'goal-wgu', title: 'B.S. Computer Science' } as Goal
    await db.goals.add(goal)
    const { tasks } = await applyRoutine(
      {
        tasks: [
          { title: 'C779 · Review CSS layout', goalId: 'goal-wgu' },
          { title: 'D278 · Review Big-O', goalId: 'deleted-goal' },
        ],
      },
      TODAY,
      { now: NOW },
    )
    expect(tasks.map((t) => t.goalId)).toEqual(['goal-wgu', null])
  })

  it('undo deletes untouched tasks and sends touched ones to the Trash', async () => {
    const { tasks, undo } = await applyRoutine(PAYLOAD, TODAY, { now: NOW })
    const [first, second, third] = tasks
    if (!first || !second || !third) throw new Error('expected three tasks')
    await updateTask(second.id, { title: 'C182 · Practice questions (hard set)' }, { now: NOW + 5 })
    await completeTask(third.id, { now: NOW + 10 })

    await undo()
    expect(await db.tasks.get(first.id)).toBeUndefined()
    expect(await db.tasks.get(second.id)).toBeUndefined()
    expect(await db.tasks.get(third.id)).toBeUndefined()
    const trashed = (await db.trash.toArray()).map((t) => t.entityId).sort()
    expect(trashed).toEqual([second.id, third.id].sort())
  })
})
