import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { onDomainEvent, resetDomainEvents, settleDomainEvents, type DomainEvent } from '@/db/events'
import {
  createGoalWithCourses,
  createMilestone,
  createUnit,
  deleteUnit,
  reorderMilestones,
  reorderUnits,
  setMilestoneStatus,
  setUnitDone,
  trashGoal,
  trashMilestone,
  updateGoal,
  updateMilestone,
  updateUnit,
} from '@/db/repos/goals'
import type { Task } from '@/db/types'
import { atTime } from '@/logic/dates'
import { draftToRows, emptyCourse, emptyDraft, type DraftGoal } from '@/logic/goalDraft'
import { wguTemplate } from '@/logic/goalTemplates'
import { avail, goalRow, milestoneRow, unitRow, week } from '@/logic/scheduler/fixtures'

/** Monday 2026-10-05, 08:00 local. */
const MON = atTime('2026-10-05', '08:00')
const TODAY = '2026-10-05'

let events: DomainEvent[] = []

beforeEach(async () => {
  resetDomainEvents()
  events = []
  for (const type of [
    'goal.changed',
    'milestone.completed',
    'milestone.uncompleted',
    'task.deleted',
  ] as const) {
    onDomainEvent(type, (e: DomainEvent) => void events.push(e))
  }
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

const types = (): string[] => events.map((e) => e.type)

/** Course A (120 + 180 min, active) then B (150 min); Mon–Fri 60, Sat 120 (the scheduling tests' goal). */
async function seedGoal(): Promise<void> {
  await db.goals.add(goalRow({ availability: avail(week(60, 120, 0)) }))
  await db.milestones.bulkAdd([
    milestoneRow('a', { order: 0, status: 'active', estimateHours: 5 }),
    milestoneRow('b', { order: 1, estimateHours: 2.5 }),
  ])
  await db.units.bulkAdd([
    unitRow('a1', 'a', 120),
    unitRow('a2', 'a', 180, { order: 1 }),
    unitRow('b1', 'b', 150),
  ])
}

const scheduled = async (): Promise<Task[]> =>
  (await db.tasks.toArray())
    .filter((t) => t.source === 'schedule')
    .sort((x, y) => (x.dueDate ?? '').localeCompare(y.dueDate ?? '') || x.orderInDay - y.orderInDay)

const keys = async (): Promise<string[]> => (await scheduled()).map((t) => t.scheduleKey ?? '')

function ids(): () => string {
  let n = 0
  return () => `id${++n}`
}

describe('createGoalWithCourses', () => {
  const draft = (): DraftGoal => ({
    ...emptyDraft(TODAY),
    title: 'Certification prep',
    icon: '📜',
    targetDate: '2026-12-31',
    courses: [
      {
        ...emptyCourse(() => 'a'),
        title: 'Networking basics',
        code: 'N100',
        hours: '4',
        cus: '2',
        units: 'Layers\nRouting',
      },
      { ...emptyCourse(() => 'b'), title: 'Security basics', hours: '2', prerequisiteKeys: ['a'] },
    ],
  })

  it('saves the goal, courses and units in one go, then builds the first plan', async () => {
    const rows = draftToRows(draft(), { today: TODAY, now: MON, newId: ids() })
    const created = await createGoalWithCourses(rows, { now: MON })

    expect(await db.goals.count()).toBe(1)
    expect(await db.milestones.count()).toBe(2)
    expect(await db.units.count()).toBe(2)
    expect(created.goal).toMatchObject({ title: 'Certification prep', order: 0 })
    // The wizard plan sets the baseline and the projection, and turns the units into tasks.
    expect(created.summary?.reason).toBe('wizard')
    expect(created.goal.baselineEnd).not.toBeNull()
    expect(created.goal.projection?.feasible).toBe(true)
    const tasks = await scheduled()
    expect(tasks.length).toBeGreaterThan(0)
    expect(tasks.every((t) => t.goalId === created.goal.id)).toBe(true)
    // 4 h + 2 h at one hour a day, Mon–Fri, from Mon 5 Oct: six study days, so it ends Mon 12 Oct.
    expect(created.goal.projection?.end).toBe('2026-10-12')
    expect(tasks.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0)).toBe(360)
    // The second course waits for the first.
    const [a, b] = created.milestones
    expect(b?.prerequisiteIds).toEqual([a?.id])
    expect(types()).toContain('goal.changed')
  })

  it('appends after the goals that exist', async () => {
    await db.goals.add(goalRow({ id: 'old', order: 5 }))
    const rows = draftToRows(draft(), { today: TODAY, now: MON, newId: ids() })
    const created = await createGoalWithCourses(rows, { now: MON, rebalance: false })
    expect(created.goal.order).toBeGreaterThan(5)
    expect(created.summary).toBeNull()
    expect(await db.tasks.count()).toBe(0)
  })

  it('takes the WGU template', async () => {
    let n = 0
    const rows = draftToRows(
      wguTemplate(TODAY, () => `k${++n}`),
      { today: TODAY, now: MON, newId: ids() },
    )
    const created = await createGoalWithCourses(rows, { now: MON })
    expect(created.milestones).toHaveLength(7)
    expect(created.units).toHaveLength(37)
    expect(created.goal.projection?.feasible).toBe(true)
    expect(created.goal.terms).toHaveLength(1)
  })

  it('refuses rows that do not belong together, writing nothing', async () => {
    const rows = draftToRows(draft(), { today: TODAY, now: MON, newId: ids() })
    await expect(
      createGoalWithCourses({ ...rows, goal: { ...rows.goal, title: '  ' } }),
    ).rejects.toThrow('title')
    const [first] = rows.milestones
    await expect(
      createGoalWithCourses({
        ...rows,
        milestones: [{ ...(first as (typeof rows.milestones)[0]), goalId: 'other' }],
      }),
    ).rejects.toThrow('belong')
    await expect(
      createGoalWithCourses({
        ...rows,
        units: rows.units.map((u) => ({ ...u, milestoneId: 'nope' })),
      }),
    ).rejects.toThrow('unit')
    await expect(
      createGoalWithCourses({ ...rows, milestones: [...rows.milestones, ...rows.milestones] }),
    ).rejects.toThrow('unique')
    expect(await db.goals.count()).toBe(0)
    expect(await db.milestones.count()).toBe(0)
  })
})

describe('updateGoal', () => {
  it('trims the title, ignores an empty one, and returns null for a missing goal', async () => {
    await seedGoal()
    expect(
      (await updateGoal('goal-1', { title: '  B.S.   Computer   Science ' }, { rebalance: false }))
        ?.title,
    ).toBe('B.S. Computer Science')
    expect((await updateGoal('goal-1', { title: '   ' }, { rebalance: false }))?.title).toBe(
      'B.S. Computer Science',
    )
    expect(await updateGoal('nope', { title: 'x' })).toBeNull()
  })

  it('writes only what changed', async () => {
    await seedGoal()
    const before = await db.goals.get('goal-1')
    const same = await updateGoal('goal-1', { icon: before?.icon, targetDate: null }, { now: MON })
    expect(same?.updatedAt).toBe(before?.updatedAt)
    expect(events.filter((e) => e.type === 'goal.changed')).toHaveLength(0)
  })

  it('does not re-plan for a rename or notes, but does for dates and availability', async () => {
    await seedGoal()
    await updateGoal(
      'goal-1',
      { title: 'Renamed', notes: [{ id: 'n1', type: 'p', text: 'Hi' }] },
      { now: MON },
    )
    expect(await db.tasks.count()).toBe(0)

    // More study time: the same 8 hours fit in fewer days.
    await updateGoal('goal-1', { availability: avail(week(120, 120, 0)) }, { now: MON })
    const tasks = await scheduled()
    expect(tasks.length).toBeGreaterThan(0)
    expect(Math.max(...tasks.map((t) => t.estimateMinutes ?? 0))).toBeLessThanOrEqual(90)
    const goal = await db.goals.get('goal-1')
    expect(goal?.projection?.end).toBe('2026-10-08')
    expect(goal?.lastRebalancedOn).toBe(TODAY)
  })

  it('a target date re-plans and shows the slip', async () => {
    await seedGoal()
    await updateGoal('goal-1', { targetDate: '2026-10-07' }, { now: MON })
    const goal = await db.goals.get('goal-1')
    expect(goal?.projection?.feasible).toBe(false)
    expect(goal?.projection?.slipDays).toBeGreaterThan(0)
  })

  it('days off push the plan out', async () => {
    await seedGoal()
    await updateGoal('goal-1', { targetDate: '2026-12-31' }, { now: MON })
    const first = (await db.goals.get('goal-1'))?.projection?.end
    await updateGoal(
      'goal-1',
      {
        availability: avail(week(60, 120, 0), [
          { start: '2026-10-06', end: '2026-10-09', label: 'Trip' },
        ]),
      },
      { now: MON },
    )
    const tasks = await scheduled()
    expect(
      tasks.some((t) => (t.dueDate ?? '') >= '2026-10-06' && (t.dueDate ?? '') <= '2026-10-09'),
    ).toBe(false)
    expect((await db.goals.get('goal-1'))?.projection?.end).not.toBe(first)
  })

  it('marking a goal done stamps the time; reopening clears it', async () => {
    await seedGoal()
    const done = await updateGoal('goal-1', { status: 'done' }, { now: MON, rebalance: false })
    expect(done?.completedAt).toBe(MON)
    expect(
      (await updateGoal('goal-1', { status: 'active' }, { rebalance: false }))?.completedAt,
    ).toBeNull()
  })
})

describe('courses', () => {
  it('adds a course at the end and plans it', async () => {
    await seedGoal()
    const added = await createMilestone(
      'goal-1',
      { title: '  Capstone  ', code: ' C999 ', estimateHours: 1, cus: 3, courseType: 'PA' },
      { now: MON },
    )
    expect(added).toMatchObject({
      title: 'Capstone',
      code: 'C999',
      order: 2,
      status: 'todo',
      cus: 3,
      courseType: 'PA',
    })
    expect((await keys()).some((k) => k.startsWith(`${added?.id}`))).toBe(true)
    expect(await createMilestone('goal-1', { title: '   ' })).toBeNull()
    expect(await createMilestone('nope', { title: 'x' })).toBeNull()
  })

  it('edits fields, cleans them, and re-plans when the hours change', async () => {
    await seedGoal()
    await db.units.where('milestoneId').equals('b').delete()
    await rebalanceQuiet()
    const updated = await updateMilestone(
      'b',
      { title: ' Course  B2 ', code: '  ', cus: 99, estimateHours: 4, courseType: 'OA+PA' },
      { now: MON },
    )
    expect(updated).toMatchObject({
      title: 'Course B2',
      code: null,
      cus: 40,
      estimateHours: 4,
      courseType: 'OA+PA',
    })
    // 4 h of synthetic study sessions now exist for B.
    const bMinutes = (await scheduled())
      .filter((t) => t.milestoneId === 'b')
      .reduce((s, t) => s + (t.estimateMinutes ?? 0), 0)
    expect(bMinutes).toBe(240)
    expect((await updateMilestone('b', { estimateHours: -3 }, { now: MON }))?.estimateHours).toBe(0)
    expect(
      (await updateMilestone('b', { estimateHours: 99999 }, { now: MON }))?.estimateHours,
    ).toBe(2000)
    expect(await updateMilestone('nope', { title: 'x' })).toBeNull()
  })

  it('keeps prerequisites to other courses of the same goal', async () => {
    await seedGoal()
    await db.goals.add(goalRow({ id: 'goal-2', order: 1 }))
    await db.milestones.add(milestoneRow('x', { goalId: 'goal-2' }))
    const updated = await updateMilestone(
      'b',
      { prerequisiteIds: ['a', 'a', 'b', 'x', 'ghost'] },
      { rebalance: false },
    )
    expect(updated?.prerequisiteIds).toEqual(['a'])
  })

  it('a rename alone updates the titles of the open tasks', async () => {
    await seedGoal()
    await updateGoal('goal-1', { targetDate: '2026-12-31' }, { now: MON })
    expect((await scheduled())[0]?.title).toContain('A ·')
    await updateMilestone('a', { code: 'Z9' }, { now: MON })
    expect((await scheduled())[0]?.title).toContain('Z9 ·')
  })

  it('does nothing when nothing changes', async () => {
    await seedGoal()
    const a = await db.milestones.get('a')
    const same = await updateMilestone('a', { title: a?.title, cus: a?.cus }, { now: MON })
    expect(same?.updatedAt).toBe(a?.updatedAt)
  })
})

/** Plans goal-1 once, so tests can start from a scheduled goal. */
async function rebalanceQuiet(): Promise<void> {
  const { rebalanceGoal } = await import('@/db/repos/goals')
  await rebalanceGoal('goal-1', { now: MON, reason: 'manual' })
}

describe('setMilestoneStatus', () => {
  it('completing a course removes its work and pulls the next one forward, and undo puts it back', async () => {
    await seedGoal()
    await rebalanceQuiet()
    const endBefore = (await db.goals.get('goal-1'))?.projection?.end
    expect((await keys()).some((k) => k.startsWith('a'))).toBe(true)
    events = []

    const result = await setMilestoneStatus('a', 'done', { now: MON })
    expect(result?.milestone).toMatchObject({ status: 'done', completedAt: MON })
    expect(await keys()).toEqual(['b1:1', 'b1:2', 'b1:3'])
    const first = (await scheduled())[0]
    expect(first?.dueDate).toBe(TODAY)
    expect((await db.goals.get('goal-1'))?.projection?.end).not.toBe(endBefore)
    expect(types()).toContain('milestone.completed')

    events = []
    await result?.undo()
    expect(await db.milestones.get('a')).toMatchObject({ status: 'active', completedAt: null })
    expect((await keys()).some((k) => k.startsWith('a'))).toBe(true)
    expect((await db.goals.get('goal-1'))?.projection?.end).toBe(endBefore)
    expect(types()).toContain('milestone.uncompleted')
  })

  it('reopening a done course announces it, and a same-status call is a no-op', async () => {
    await seedGoal()
    await setMilestoneStatus('a', 'done', { now: MON, rebalance: false })
    events = []
    const noopResult = await setMilestoneStatus('a', 'done', { now: MON, rebalance: false })
    expect(noopResult?.milestone.status).toBe('done')
    expect(events).toHaveLength(0)

    const reopened = await setMilestoneStatus('a', 'active', { now: MON, rebalance: false })
    expect(reopened?.milestone).toMatchObject({ status: 'active', completedAt: null })
    expect(types()).toContain('milestone.uncompleted')
    events = []
    await reopened?.undo()
    expect((await db.milestones.get('a'))?.status).toBe('done')
    expect(types()).toContain('milestone.completed')
    expect(await setMilestoneStatus('nope', 'done')).toBeNull()
  })
})

describe('reorderMilestones', () => {
  it('renumbers, re-plans in the new order, and undoes', async () => {
    await seedGoal()
    await rebalanceQuiet()
    expect((await keys())[0]).toBe('a1:1')

    const { undo } = await reorderMilestones('goal-1', ['b', 'a'], { now: MON })
    expect((await db.milestones.get('b'))?.order).toBe(0)
    expect((await db.milestones.get('a'))?.order).toBe(1)
    // A is `active`, so it still goes first in the queue: status beats order (DECISIONS: Scheduler).
    // Make B the one in progress to see the new order take effect.
    await setMilestoneStatus('b', 'active', { now: MON })
    await setMilestoneStatus('a', 'todo', { now: MON })
    expect((await keys())[0]).toBe('b1:1')

    await undo()
    expect((await db.milestones.get('a'))?.order).toBe(0)
    expect((await db.milestones.get('b'))?.order).toBe(1)
  })

  it('ignores unknown ids, keeps unlisted courses after the listed ones, and skips a no-op', async () => {
    await seedGoal()
    await db.milestones.add(milestoneRow('c', { order: 2 }))
    await reorderMilestones('goal-1', ['c', 'ghost'], { rebalance: false })
    const order = (await db.milestones.toArray()).sort((a, b) => a.order - b.order).map((m) => m.id)
    expect(order).toEqual(['c', 'a', 'b'])
    events = []
    const result = await reorderMilestones('goal-1', ['c', 'a', 'b'], { rebalance: false })
    await result.undo()
    expect(events).toHaveLength(0)
  })
})

describe('trashMilestone', () => {
  it('moves the course, its units and tasks to the trash, drops it from prerequisites, and undoes', async () => {
    await seedGoal()
    await db.milestones.update('b', { prerequisiteIds: ['a'] })
    await rebalanceQuiet()
    const before = (await scheduled()).length
    expect(before).toBeGreaterThan(0)

    const trashed = await trashMilestone('a', { now: MON })
    expect(trashed?.item.entityTable).toBe('milestones')
    expect(await db.milestones.get('a')).toBeUndefined()
    expect(await db.units.where('milestoneId').equals('a').count()).toBe(0)
    expect((await db.milestones.get('b'))?.prerequisiteIds).toEqual([])
    // Only B's work is left, and it now starts today.
    expect(await keys()).toEqual(['b1:1', 'b1:2', 'b1:3'])
    expect(await db.trash.count()).toBe(1)

    await trashed?.undo()
    expect(await db.trash.count()).toBe(0)
    expect(await db.milestones.get('a')).toBeDefined()
    expect(await db.units.where('milestoneId').equals('a').count()).toBe(2)
    expect((await db.milestones.get('b'))?.prerequisiteIds).toEqual(['a'])
    expect((await scheduled()).length).toBe(before)
    expect(await trashMilestone('nope')).toBeNull()
  })
})

describe('trashGoal', () => {
  it('takes everything under the goal to the trash and brings it back', async () => {
    await seedGoal()
    await rebalanceQuiet()
    const tasks = await db.tasks.count()
    const trashed = await trashGoal('goal-1', { now: MON })
    expect(trashed?.item.entityTable).toBe('goals')
    expect(await db.goals.count()).toBe(0)
    expect(await db.milestones.count()).toBe(0)
    expect(await db.units.count()).toBe(0)
    expect(await db.tasks.count()).toBe(0)
    await trashed?.undo()
    expect(await db.goals.count()).toBe(1)
    expect(await db.milestones.count()).toBe(2)
    expect(await db.units.count()).toBe(3)
    expect(await db.tasks.count()).toBe(tasks)
    expect(await trashGoal('nope')).toBeNull()
  })
})

describe('units', () => {
  it('adds a unit at the end of its course and plans it', async () => {
    await seedGoal()
    const added = await createUnit('b', { title: '  Review  ', estimateMinutes: 62 }, { now: MON })
    expect(added).toMatchObject({
      goalId: 'goal-1',
      milestoneId: 'b',
      title: 'Review',
      order: 1,
      estimateMinutes: 60,
      status: 'todo',
    })
    expect((await keys()).some((k) => k.startsWith(`${added?.id}:`))).toBe(true)
    expect(await createUnit('b', { title: ' ' })).toBeNull()
    expect(await createUnit('nope', { title: 'x' })).toBeNull()
  })

  it('edits a unit, and re-plans for its minutes', async () => {
    await seedGoal()
    await rebalanceQuiet()
    const updated = await updateUnit(
      'b1',
      { title: ' Final  review ', estimateMinutes: 60, difficulty: 3 },
      { now: MON },
    )
    expect(updated).toMatchObject({ title: 'Final review', estimateMinutes: 60, difficulty: 3 })
    const b = (await scheduled()).filter((t) => t.scheduleKey?.startsWith('b1:'))
    expect(b.reduce((s, t) => s + (t.estimateMinutes ?? 0), 0)).toBe(60)
    expect(
      (await updateUnit('b1', { estimateMinutes: null }, { now: MON }))?.estimateMinutes,
    ).toBeNull()
    expect(await updateUnit('nope', { title: 'x' })).toBeNull()
  })

  it('checking a unit off removes its work, starts the course, and undoes', async () => {
    await seedGoal()
    await rebalanceQuiet()
    const done = await setUnitDone('b1', true, { now: MON })
    expect(done?.unit).toMatchObject({ status: 'done', completedAt: MON })
    // B was not started: checking its unit starts it.
    expect((await db.milestones.get('b'))?.status).toBe('active')
    expect((await keys()).some((k) => k.startsWith('b1'))).toBe(false)

    await done?.undo()
    expect(await db.units.get('b1')).toMatchObject({ status: 'todo', completedAt: null })
    expect((await db.milestones.get('b'))?.status).toBe('todo')
    expect((await keys()).some((k) => k.startsWith('b1'))).toBe(true)

    // Already in the requested state: nothing happens.
    events = []
    const again = await setUnitDone('b1', false, { now: MON })
    await again?.undo()
    expect(events).toHaveLength(0)
    expect(await setUnitDone('nope', true)).toBeNull()
  })

  it('does not restart a course that is already in progress', async () => {
    await seedGoal()
    const done = await setUnitDone('a1', true, { now: MON, rebalance: false })
    expect((await db.milestones.get('a'))?.status).toBe('active')
    await done?.undo()
    expect((await db.milestones.get('a'))?.status).toBe('active')
  })

  it('reorders and undoes', async () => {
    await seedGoal()
    const { undo } = await reorderUnits('a', ['a2', 'a1'], { rebalance: false })
    expect((await db.units.get('a2'))?.order).toBe(0)
    expect((await db.units.get('a1'))?.order).toBe(1)
    await undo()
    expect((await db.units.get('a1'))?.order).toBe(0)
    expect((await db.units.get('a2'))?.order).toBe(1)
    events = []
    await (await reorderUnits('a', ['a1', 'a2'], { rebalance: false })).undo()
    expect(events).toHaveLength(0)
  })

  it('deletes a unit to the trash and restores it', async () => {
    await seedGoal()
    await rebalanceQuiet()
    const trashed = await deleteUnit('a2', { now: MON })
    expect(await db.units.get('a2')).toBeUndefined()
    expect((await keys()).some((k) => k.startsWith('a2'))).toBe(false)
    await trashed?.undo()
    expect(await db.units.get('a2')).toBeDefined()
    expect((await keys()).some((k) => k.startsWith('a2'))).toBe(true)
    expect(await deleteUnit('nope')).toBeNull()
  })
})
