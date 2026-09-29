import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { onDomainEvent, resetDomainEvents, settleDomainEvents, type DomainEvent } from '@/db/events'
import {
  moveToTrash,
  purgeExpired,
  restoreFromTrash,
  TRASH_TTL_MS,
  trashedTasks,
} from '@/db/repos/trash'
import { createTask } from '@/db/repos/tasks'
import type { Goal, Milestone, Resource, Unit } from '@/db/types'

const NOW = new Date(2026, 8, 29, 9, 30).getTime()

let events: DomainEvent[] = []

beforeEach(async () => {
  resetDomainEvents()
  events = []
  onDomainEvent('goal.changed', (e) => void events.push(e))
  onDomainEvent('task.deleted', (e) => void events.push(e))
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

const goal = (id: string): Goal => ({
  id,
  createdAt: 1,
  updatedAt: 2,
  title: 'B.S. Computer Science — WGU',
  icon: '🎓',
  cover: null,
  kind: 'degree',
  status: 'active',
  startDate: '2026-08-15',
  targetDate: '2027-03-31',
  availability: { minutesByWeekday: [0, 60, 60, 60, 60, 60, 0], daysOff: [] },
  terms: [],
  notes: [],
  order: 0,
  baselineEnd: null,
  projection: null,
  lastRebalancedOn: null,
  completedAt: null,
})

const course = (id: string, goalId: string, code: string, title: string): Milestone => ({
  id,
  createdAt: 3,
  updatedAt: 4,
  goalId,
  kind: 'course',
  code,
  title,
  icon: null,
  cover: null,
  status: 'todo',
  order: 0,
  prerequisiteIds: [],
  estimateHours: 30,
  dueDate: null,
  cus: 3,
  courseType: 'OA',
  termId: null,
  notes: [],
  projectedStart: null,
  projectedEnd: null,
  completedAt: null,
})

const unit = (id: string, goalId: string, milestoneId: string): Unit => ({
  id,
  createdAt: 5,
  updatedAt: 6,
  goalId,
  milestoneId,
  title: 'CSS layout',
  order: 0,
  estimateMinutes: 90,
  difficulty: 2,
  status: 'todo',
  completedAt: null,
})

describe('moveToTrash and restoreFromTrash', () => {
  it('moves a task into one trash row with a 30-day expiry and restores it unchanged', async () => {
    const task = await createTask({ title: 'Renew library card', tags: ['errands'] }, { now: NOW })
    const result = await moveToTrash('tasks', task.id, { now: NOW + 1 })

    expect(result?.item).toMatchObject({
      entityTable: 'tasks',
      entityId: task.id,
      title: 'Renew library card',
      createdAt: NOW + 1,
      expiresAt: NOW + 1 + TRASH_TTL_MS,
    })
    expect(trashedTasks(result!.item)).toHaveLength(1)
    expect(await db.tasks.count()).toBe(0)
    expect(await db.trash.count()).toBe(1)

    const restored = await restoreFromTrash(result!.trashId)
    expect(restored?.entityId).toBe(task.id)
    expect(await db.tasks.get(task.id)).toEqual(task)
    expect(await db.trash.count()).toBe(0)
  })

  it('returns null for a missing row or a missing trash entry', async () => {
    expect(await moveToTrash('tasks', 'nope')).toBeNull()
    expect(await restoreFromTrash('nope')).toBeNull()
    expect(await db.trash.count()).toBe(0)
  })

  it('takes a course with its units, tasks and resources, and brings them all back', async () => {
    await db.goals.add(goal('g1'))
    await db.milestones.bulkAdd([
      course('m1', 'g1', 'C779', 'Web Development Foundations'),
      course('m2', 'g1', 'D278', 'Scripting and Programming Foundations'),
    ])
    await db.units.bulkAdd([unit('u1', 'g1', 'm1'), unit('u2', 'g1', 'm2')])
    const chunk = await createTask(
      {
        title: 'C779 · Unit 3: CSS layout (45 min)',
        goalId: 'g1',
        milestoneId: 'm1',
        unitId: 'u1',
      },
      { now: NOW },
    )
    const other = await createTask(
      { title: 'D278 reading', goalId: 'g1', milestoneId: 'm2' },
      { now: NOW },
    )
    const resource: Resource = {
      id: 'r1',
      createdAt: 7,
      updatedAt: 8,
      goalId: 'g1',
      milestoneId: 'm1',
      kind: 'link',
      title: 'MDN grid guide',
      url: 'https://developer.mozilla.org/docs/Web/CSS/CSS_grid_layout',
      fileId: null,
      status: 'toRead',
      notes: '',
      order: 0,
    }
    await db.resources.add(resource)

    const result = await moveToTrash('milestones', 'm1', { now: NOW })
    expect(result?.item.title).toBe('C779 Web Development Foundations')
    expect(Object.keys(result!.item.payload).sort()).toEqual([
      'milestones',
      'resources',
      'tasks',
      'units',
    ])
    expect(await db.milestones.count()).toBe(1)
    expect(await db.units.count()).toBe(1)
    expect(await db.resources.count()).toBe(0)
    expect(await db.tasks.get(chunk.id)).toBeUndefined()
    // Other courses are untouched.
    expect(await db.tasks.get(other.id)).toBeDefined()

    await result!.undo()
    expect(await db.milestones.count()).toBe(2)
    expect(await db.units.count()).toBe(2)
    expect(await db.resources.get('r1')).toEqual(resource)
    expect(await db.tasks.get(chunk.id)).toEqual(chunk)
  })

  it('takes a whole goal in one entry, including its files', async () => {
    await db.goals.add(goal('g1'))
    await db.milestones.add(course('m1', 'g1', 'C182', 'Introduction to IT'))
    await db.units.add(unit('u1', 'g1', 'm1'))
    await createTask(
      { title: 'C182 · Unit 1: Hardware (30 min)', goalId: 'g1', milestoneId: 'm1' },
      { now: NOW },
    )
    const blob = new Blob(['%PDF-1.7 study guide'], { type: 'application/pdf' })
    await db.files.add({
      id: 'f1',
      name: 'C182 study guide.pdf',
      mime: 'application/pdf',
      size: blob.size,
      blob,
    })
    await db.resources.add({
      id: 'r1',
      goalId: 'g1',
      milestoneId: 'm1',
      kind: 'pdf',
      title: 'Study guide',
      url: null,
      fileId: 'f1',
      status: 'toRead',
      notes: '',
      order: 0,
    })
    await createTask({ title: 'Unrelated task' }, { now: NOW })

    const result = await moveToTrash('goals', 'g1', { now: NOW })
    expect(Object.keys(result!.item.payload).sort()).toEqual([
      'files',
      'goals',
      'milestones',
      'resources',
      'tasks',
      'units',
    ])
    expect(await db.goals.count()).toBe(0)
    expect(await db.files.count()).toBe(0)
    // Only the unrelated task is left.
    expect(await db.tasks.count()).toBe(1)

    await restoreFromTrash(result!.trashId)
    expect(await db.goals.count()).toBe(1)
    expect(await db.files.get('f1')).toMatchObject({
      name: 'C182 study guide.pdf',
      size: blob.size,
    })
    expect(await db.tasks.count()).toBe(2)
    await settleDomainEvents()
    expect(events.filter((e) => e.type === 'goal.changed').length).toBeGreaterThan(0)
  })

  it('emits task.deleted for every trashed task', async () => {
    const a = await createTask({ title: 'A' }, { now: NOW })
    await moveToTrash('tasks', a.id, { now: NOW })
    await settleDomainEvents()
    expect(events).toContainEqual({ type: 'task.deleted', taskId: a.id })
  })
})

describe('purgeExpired', () => {
  it('removes only entries past their expiry', async () => {
    const a = await createTask({ title: 'A' }, { now: NOW })
    const b = await createTask({ title: 'B' }, { now: NOW })
    await moveToTrash('tasks', a.id, { now: NOW })
    await moveToTrash('tasks', b.id, { now: NOW + 10 * 24 * 60 * 60 * 1000 })

    expect(await purgeExpired(NOW + 29 * 24 * 60 * 60 * 1000)).toBe(0)
    expect(await purgeExpired(NOW + TRASH_TTL_MS)).toBe(1)
    const left = await db.trash.toArray()
    expect(left.map((t) => t.title)).toEqual(['B'])
  })
})
