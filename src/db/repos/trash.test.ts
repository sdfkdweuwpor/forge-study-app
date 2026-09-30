import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { onDomainEvent, resetDomainEvents, settleDomainEvents, type DomainEvent } from '@/db/events'
import {
  countTrash,
  emptyTrash,
  listTrash,
  moveToTrash,
  purgeExpired,
  purgeTrashItem,
  restoreFromTrash,
  restoreTrashItem,
  TRASH_TTL_MS,
  trashedTasks,
} from '@/db/repos/trash'
import { trashExpiry } from '@/logic/retention'
import { createTask } from '@/db/repos/tasks'
import type { Goal, Milestone, Resource, Unit } from '@/db/types'
import { planningFromAvailability, wguPlannedAssessments } from '@/logic/schemaV2'

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
  planning: planningFromAvailability(
    { minutesByWeekday: [0, 60, 60, 60, 60, 60, 0], daysOff: [] },
    '2027-03-31',
  ),
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
  selfRating: null,
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
  selfRating: null,
  estimateSource: 'hours',
  baseEstimateMinutes: 90,
  optional: false,
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

  it('takes the v2 plan rows with a goal: planned assessments, proposals, questions, readiness', async () => {
    await db.goals.add(goal('g1'))
    const c = course('m1', 'g1', 'C182', 'Introduction to IT')
    await db.milestones.add(c)
    await db.plannedAssessments.bulkAdd(wguPlannedAssessments([c], NOW))
    await db.planProposals.add({
      id: 'p1',
      goalId: 'g1',
      kind: 'extendDate',
      status: 'pending',
      computedFor: '2026-09-29',
      title: 'Move the finish date',
      detail: '',
      apply: { targetDate: '2027-04-30' },
      preview: { moved: [], added: [], removed: [] },
      baseRevision: '0-0',
      decidedAt: null,
    })
    await db.practiceQuestions.add({
      id: 'q1',
      goalId: 'g1',
      milestoneId: 'm1',
      unitId: null,
      prompt: 'What does a NIC do?',
      choices: null,
      answer: 'Connects a computer to a network',
      explanation: '',
      tags: [],
      source: 'user',
      noteRef: null,
      suspended: false,
    })
    await db.questionAttempts.add({
      id: 'qa1',
      questionId: 'q1',
      goalId: 'g1',
      milestoneId: 'm1',
      at: NOW,
      day: '2026-09-29',
      correct: false,
      answer: 'Stores files',
      requeueOn: '2026-09-30',
    })
    await db.readiness.add({
      id: 'm1',
      goalId: 'g1',
      milestoneId: 'm1',
      unitId: null,
      score: 0.6,
      extraReviewMinutes: 30,
      inputs: { paPct: 60, cardRetention: null, questionAccuracy: null, unitsDonePct: 0.5 },
      computedAt: NOW,
    })

    const result = await moveToTrash('goals', 'g1', { now: NOW })
    expect(Object.keys(result!.item.payload).sort()).toEqual([
      'goals',
      'milestones',
      'planProposals',
      'plannedAssessments',
      'practiceQuestions',
      'questionAttempts',
      'readiness',
    ])
    for (const t of [
      db.plannedAssessments,
      db.planProposals,
      db.practiceQuestions,
      db.questionAttempts,
      db.readiness,
    ])
      expect(await t.count()).toBe(0)
    await restoreFromTrash(result!.trashId)
    expect(await db.plannedAssessments.get('m1:oa')).toMatchObject({ kind: 'exam', goalId: 'g1' })
    expect(await db.questionAttempts.get('qa1')).toMatchObject({ requeueOn: '2026-09-30' })
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

describe('the expiry is 30 calendar days', () => {
  it('keeps the local time across a DST change instead of adding 720 hours', async () => {
    const before = new Date(2026, 9, 15, 9, 30).getTime() // the clocks fall back on 2026-11-01
    const task = await createTask({ title: 'Renew library card' }, { now: before })
    const result = await moveToTrash('tasks', task.id, { now: before })
    expect(result?.item.expiresAt).toBe(new Date(2026, 10, 14, 9, 30).getTime())
    expect(result?.item.expiresAt).toBe(trashExpiry(before))
    expect(result!.item.expiresAt - before).toBe(TRASH_TTL_MS + 60 * 60 * 1000)
  })
})

/** A goal with two courses; each has a unit and a scheduled chunk. */
async function seedDegree(): Promise<{ chunk779: string; chunk182: string }> {
  await db.goals.add(goal('g1'))
  await db.milestones.bulkAdd([
    course('m1', 'g1', 'C779', 'Web Development Foundations'),
    course('m2', 'g1', 'C182', 'Introduction to IT'),
  ])
  await db.units.bulkAdd([unit('u1', 'g1', 'm1'), unit('u2', 'g1', 'm2')])
  const a = await createTask(
    { title: 'C779 · Unit 3: CSS layout (45 min)', goalId: 'g1', milestoneId: 'm1', unitId: 'u1' },
    { now: NOW },
  )
  const b = await createTask(
    { title: 'C182 · Unit 1: Hardware (30 min)', goalId: 'g1', milestoneId: 'm2', unitId: 'u2' },
    { now: NOW },
  )
  return { chunk779: a.id, chunk182: b.id }
}

describe('listTrash', () => {
  it('is empty for an empty trash and lists entries newest first with what came along', async () => {
    expect(await listTrash()).toEqual([])
    const { chunk779 } = await seedDegree()
    const solo = await createTask({ title: 'Renew library card' }, { now: NOW })
    await moveToTrash('tasks', solo.id, { now: NOW })
    await moveToTrash('milestones', 'm1', { now: NOW + 1000 })

    const entries = await listTrash()
    expect(entries.map((e) => e.title)).toEqual([
      'C779 Web Development Foundations',
      'Renew library card',
    ])
    const [c779, card] = entries
    expect(c779).toMatchObject({
      table: 'milestones',
      deletedAt: NOW + 1000,
      contents: { units: 1, tasks: 1 },
      parents: [],
      restorable: true,
    })
    expect(card).toMatchObject({ table: 'tasks', contents: {}, parents: [], restorable: true })
    expect(await db.tasks.get(chunk779)).toBeUndefined()
    expect(await countTrash()).toBe(2)
  })

  it('names the container of a task whose goal was trashed after it', async () => {
    const { chunk779 } = await seedDegree()
    await moveToTrash('tasks', chunk779, { now: NOW })
    await moveToTrash('goals', 'g1', { now: NOW + 1000 })

    const entries = await listTrash()
    const task = entries.find((e) => e.table === 'tasks')
    expect(task?.restorable).toBe(true)
    // The goal, the course and the unit are all inside the goal's entry.
    expect(task?.parents.map((p) => [p.table, p.state, p.title]).sort()).toEqual([
      ['goals', 'trashed', 'B.S. Computer Science — WGU'],
      ['milestones', 'trashed', 'C779 Web Development Foundations'],
      ['units', 'trashed', 'CSS layout'],
    ])
    const goalEntry = entries.find((e) => e.table === 'goals')
    expect(task?.parents.find((p) => p.table === 'goals')?.trashId).toBe(goalEntry?.id)
  })
})

describe('restoreTrashItem: containers', () => {
  it('restores a plain task on its own', async () => {
    const solo = await createTask({ title: 'Renew library card' }, { now: NOW })
    const trashed = await moveToTrash('tasks', solo.id, { now: NOW })
    const out = await restoreTrashItem(trashed!.trashId, { now: NOW + 5 })
    expect(out).toMatchObject({ ok: true, alsoRestored: [], detached: [] })
    expect(await db.tasks.get(solo.id)).toEqual(solo)
    expect(await db.trash.count()).toBe(0)
  })

  it('restores a task whose container is still in the app without touching anything else', async () => {
    const { chunk779 } = await seedDegree()
    const before = await db.tasks.get(chunk779)
    const trashed = await moveToTrash('tasks', chunk779, { now: NOW })
    const out = await restoreTrashItem(trashed!.trashId)
    expect(out).toMatchObject({ ok: true, alsoRestored: [], detached: [] })
    expect(await db.tasks.get(chunk779)).toEqual(before)
  })

  it('brings the goal back too when the task was trashed first and the goal after it', async () => {
    const { chunk779, chunk182 } = await seedDegree()
    const before = await db.tasks.get(chunk779)
    const task = await moveToTrash('tasks', chunk779, { now: NOW })
    await moveToTrash('goals', 'g1', { now: NOW + 1000 })
    expect(await db.goals.count()).toBe(0)

    const out = await restoreTrashItem(task!.trashId, { now: NOW + 2000 })
    if (!out.ok) throw new Error(out.message)
    expect(out.item.entityId).toBe(chunk779)
    expect(out.alsoRestored.map((i) => i.entityTable)).toEqual(['goals'])
    expect(out.detached).toEqual([])
    // The task is back with its links, and so is everything the goal took with it.
    expect(await db.tasks.get(chunk779)).toEqual(before)
    expect(await db.goals.count()).toBe(1)
    expect(await db.milestones.count()).toBe(2)
    expect(await db.units.count()).toBe(2)
    expect(await db.tasks.get(chunk182)).toBeDefined()
    expect(await db.trash.count()).toBe(0)
  })

  it('brings back a chain: unit → course → goal, each trashed on its own', async () => {
    await seedDegree()
    const unitEntry = await moveToTrash('units', 'u1', { now: NOW })
    const courseEntry = await moveToTrash('milestones', 'm1', { now: NOW + 1000 })
    await moveToTrash('goals', 'g1', { now: NOW + 2000 })
    expect(courseEntry).not.toBeNull()

    const out = await restoreTrashItem(unitEntry!.trashId)
    if (!out.ok) throw new Error(out.message)
    // Outermost first: the goal's entry (it holds the goal and the other course), then the course's.
    expect(out.alsoRestored.map((i) => i.entityTable)).toEqual(['goals', 'milestones'])
    expect(await db.goals.count()).toBe(1)
    expect(await db.milestones.get('m1')).toBeDefined()
    expect(await db.units.get('u1')).toBeDefined()
    expect(await db.trash.count()).toBe(0)
  })

  it('undo puts every restored entry back in the trash, with the original expiry', async () => {
    const { chunk779 } = await seedDegree()
    const task = await moveToTrash('tasks', chunk779, { now: NOW })
    await moveToTrash('goals', 'g1', { now: NOW + 1000 })
    const rowsBefore = await db.trash.toArray()

    const out = await restoreTrashItem(task!.trashId)
    if (!out.ok) throw new Error(out.message)
    expect(await db.trash.count()).toBe(0)
    await out.undo()

    expect(await db.goals.count()).toBe(0)
    expect(await db.tasks.count()).toBe(0)
    const rowsAfter = await db.trash.toArray()
    expect(rowsAfter.map((r) => r.id).sort()).toEqual(rowsBefore.map((r) => r.id).sort())
    expect(rowsAfter.find((r) => r.id === task!.trashId)?.expiresAt).toBe(task!.item.expiresAt)
    // ...and restoring again works.
    expect((await restoreTrashItem(task!.trashId)).ok).toBe(true)
    expect(await db.tasks.get(chunk779)).toBeDefined()
  })

  it('restores a task without its links when the goal was deleted for good (and a chunk becomes a plain task)', async () => {
    const { chunk779 } = await seedDegree()
    await db.tasks.update(chunk779, {
      source: 'schedule',
      scheduleKey: 'u1:1',
      schedulePinned: true,
    })
    const task = await moveToTrash('tasks', chunk779, { now: NOW })
    const goalEntry = await moveToTrash('goals', 'g1', { now: NOW + 1000 })
    await purgeTrashItem(goalEntry!.trashId)

    const entry = (await listTrash()).find((e) => e.table === 'tasks')
    expect(entry?.restorable).toBe(true)
    expect(entry?.parents.every((p) => p.state === 'gone')).toBe(true)

    const out = await restoreTrashItem(task!.trashId, { now: NOW + 5000 })
    if (!out.ok) throw new Error(out.message)
    expect(out.alsoRestored).toEqual([])
    expect(out.detached.sort()).toEqual(['goals', 'milestones', 'units'])
    expect(await db.tasks.get(chunk779)).toMatchObject({
      title: 'C779 · Unit 3: CSS layout (45 min)',
      goalId: null,
      milestoneId: null,
      unitId: null,
      source: 'user',
      scheduleKey: null,
      schedulePinned: false,
      updatedAt: NOW + 5000,
    })
    expect(await db.goals.count()).toBe(0)
  })

  it('refuses a course whose goal is gone for good, writes nothing, and says why', async () => {
    await seedDegree()
    const course1 = await moveToTrash('milestones', 'm1', { now: NOW })
    const goalEntry = await moveToTrash('goals', 'g1', { now: NOW + 1000 })
    await purgeTrashItem(goalEntry!.trashId)

    const entry = (await listTrash())[0]
    expect(entry).toMatchObject({ table: 'milestones', restorable: false })
    const out = await restoreTrashItem(course1!.trashId)
    expect(out).toMatchObject({ ok: false, reason: 'parent-gone' })
    expect(await db.trash.count()).toBe(1)
    expect(await db.milestones.count()).toBe(0)
  })

  it('treats a container whose own goal is gone as gone too', async () => {
    // task → course (trashed on its own) → goal (purged): the course cannot come back, so the task leaves it behind.
    const { chunk779 } = await seedDegree()
    const task = await moveToTrash('tasks', chunk779, { now: NOW })
    await moveToTrash('milestones', 'm1', { now: NOW + 1000 })
    const goalEntry = await moveToTrash('goals', 'g1', { now: NOW + 2000 })
    await purgeTrashItem(goalEntry!.trashId)

    const out = await restoreTrashItem(task!.trashId)
    if (!out.ok) throw new Error(out.message)
    expect(out.alsoRestored).toEqual([])
    expect(out.detached).toContain('milestones')
    expect(await db.tasks.get(chunk779)).toMatchObject({ goalId: null, milestoneId: null })
    expect(await db.milestones.count()).toBe(0)
  })

  it('answers "missing" for an entry that is gone', async () => {
    expect(await restoreTrashItem('nope')).toMatchObject({ ok: false, reason: 'missing' })
  })

  it('does not restore a file that has no bytes (a marker from an old export)', async () => {
    await db.goals.add(goal('g1'))
    await db.milestones.add(course('m1', 'g1', 'C779', 'Web Development Foundations'))
    const item = await moveToTrash('milestones', 'm1', { now: NOW })
    await db.trash.update(item!.trashId, {
      payload: {
        milestones: item!.item.payload.milestones ?? [],
        files: [{ id: 'f1', name: 'guide.pdf', mime: 'application/pdf', size: 4, blob: {} }],
      },
    })
    const out = await restoreTrashItem(item!.trashId)
    expect(out.ok).toBe(true)
    expect(await db.files.count()).toBe(0)
    expect(await db.milestones.count()).toBe(1)
  })
})

describe('the Undo that moveToTrash returns', () => {
  it('brings back a goal that was trashed after the task, so the task never points at a trashed goal', async () => {
    const { chunk779 } = await seedDegree()
    const before = await db.tasks.get(chunk779)
    const task = await moveToTrash('tasks', chunk779, { now: NOW })
    await moveToTrash('goals', 'g1', { now: NOW + 1000 })

    await task!.undo()
    expect(await db.tasks.get(chunk779)).toEqual(before)
    expect(await db.goals.get('g1')).toBeDefined()
    expect(await db.milestones.count()).toBe(2)
    expect(await db.trash.count()).toBe(0)
  })

  it('restores a task without its links when the goal is gone for good, and does not throw', async () => {
    const { chunk779 } = await seedDegree()
    const task = await moveToTrash('tasks', chunk779, { now: NOW })
    const goalEntry = await moveToTrash('goals', 'g1', { now: NOW + 1000 })
    await purgeTrashItem(goalEntry!.trashId)

    await task!.undo()
    expect(await db.tasks.get(chunk779)).toMatchObject({
      goalId: null,
      milestoneId: null,
      unitId: null,
    })
    expect(await db.goals.count()).toBe(0)
  })

  it('throws, and writes nothing, for a unit whose course and goal are gone for good', async () => {
    await seedDegree()
    const unitEntry = await moveToTrash('units', 'u1', { now: NOW })
    const goalEntry = await moveToTrash('goals', 'g1', { now: NOW + 1000 })
    await purgeTrashItem(goalEntry!.trashId)

    await expect(unitEntry!.undo()).rejects.toThrow(/deleted for good/)
    expect(await db.units.count()).toBe(0)
    expect(await db.trash.count()).toBe(1)
  })

  it('does nothing, quietly, when the entry was already restored from the Trash page', async () => {
    const task = await createTask({ title: 'Renew library card' }, { now: NOW })
    const trashed = await moveToTrash('tasks', task.id, { now: NOW })
    await restoreTrashItem(trashed!.trashId)
    await expect(trashed!.undo()).resolves.toBeUndefined()
    expect(await db.tasks.get(task.id)).toEqual(task)
  })
})

describe('purgeTrashItem and emptyTrash', () => {
  it('deletes one entry for good, then reports it gone', async () => {
    const a = await createTask({ title: 'A' }, { now: NOW })
    const b = await createTask({ title: 'B' }, { now: NOW })
    const ta = await moveToTrash('tasks', a.id, { now: NOW })
    await moveToTrash('tasks', b.id, { now: NOW })
    expect(await purgeTrashItem(ta!.trashId)).toBe(true)
    expect(await purgeTrashItem(ta!.trashId)).toBe(false)
    expect((await db.trash.toArray()).map((t) => t.title)).toEqual(['B'])
    expect(await db.tasks.count()).toBe(0)
  })

  it('empties the whole trash and counts what went', async () => {
    const a = await createTask({ title: 'A' }, { now: NOW })
    const b = await createTask({ title: 'B' }, { now: NOW })
    await moveToTrash('tasks', a.id, { now: NOW })
    await moveToTrash('tasks', b.id, { now: NOW })
    expect(await emptyTrash()).toBe(2)
    expect(await emptyTrash()).toBe(0)
    expect(await countTrash()).toBe(0)
  })

  it('purges by calendar days: an item deleted on Sep 29 is there on Oct 28 and gone by Oct 29 09:30', async () => {
    const a = await createTask({ title: 'A' }, { now: NOW })
    await moveToTrash('tasks', a.id, { now: NOW })
    expect(await purgeExpired(new Date(2026, 9, 29, 9, 29).getTime())).toBe(0)
    expect(await purgeExpired(new Date(2026, 9, 29, 9, 30).getTime())).toBe(1)
  })
})
