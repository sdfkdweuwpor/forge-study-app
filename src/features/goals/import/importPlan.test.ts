import { describe, expect, it, vi } from 'vitest'
import { createTask, updateTask } from '@/db/repos/tasks'
import { atTime } from '@/logic/dates'
import {
  EXAMPLE_JSON,
  knownCourses,
  parsePlan,
  type ExistingGoal,
  type Plan,
} from '@/logic/planImport'
import { runImport } from './importPlan'
import { loadGoalSnapshot, loadGoalTasks } from './queries'

// A switch to make every new id the same, so a write collides part-way through the transaction.
const ids = vi.hoisted(() => ({ constant: null as string | null }))
vi.mock('@/lib/ids', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ids')>()
  return { ...actual, newId: () => ids.constant ?? actual.newId() }
})

/** Monday 2026-10-05, 08:00 local (TZ=America/New_York in `npm test`). */
const NOW = atTime('2026-10-05', '08:00')

/** Parses like the UI does, so a merge plan may depend on the target's courses. */
function parse(text: string, target: ExistingGoal | null = null): Plan {
  const r = parsePlan(text, { known: knownCourses(target) })
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}: ${e.message}`).join('; '))
  return r.plan
}

async function snapshot(goalId: string): Promise<ExistingGoal> {
  const s = await loadGoalSnapshot(goalId)
  if (!s) throw new Error('the goal is missing')
  return s
}

/** Fields the import owns (the scheduler also writes projected dates, which move with the clock). */
const stable = (s: ExistingGoal) =>
  s.courses.map(({ milestone: m, units }) => ({
    id: m.id,
    code: m.code,
    title: m.title,
    order: m.order,
    hours: m.estimateHours,
    cus: m.cus,
    type: m.courseType,
    due: m.dueDate,
    prereqs: m.prerequisiteIds,
    termId: m.termId,
    status: m.status,
    units: units.map((u) => [u.id, u.title, u.order, u.estimateMinutes]),
  }))

const minutesOf = async (goalId: string): Promise<number> =>
  (await loadGoalTasks(goalId)).reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0)

// Each test imports into its own goal (random ids), so the shared fake database needs no clearing.

describe('runImport: a new goal', () => {
  it('creates the goal, courses and units, then schedules the work', async () => {
    const run = await runImport(parse(EXAMPLE_JSON), { kind: 'new' }, { now: NOW })
    expect(run).toMatchObject({ mode: 'create', wrote: true, rebalanceError: null })

    const s = await snapshot(run.goalId)
    expect(s.goal).toMatchObject({
      title: 'B.S. Computer Science — WGU',
      kind: 'degree',
      targetDate: '2027-03-31',
    })
    expect(s.goal.terms).toHaveLength(1)
    expect(s.courses.map((c) => c.milestone.code)).toEqual(['C182', 'D278', 'C779'])
    expect(s.courses.map((c) => c.units.length)).toEqual([6, 0, 0])
    expect(s.courses[1]?.milestone.prerequisiteIds).toEqual([s.courses[0]?.milestone.id])
    expect(s.courses.every((c) => c.milestone.termId === s.goal.terms[0]?.id)).toBe(true)

    // rebalanceGoal ran with reason "import": tasks exist, the projection is cached, the baseline is set.
    expect(run.rebalance).toMatchObject({ reason: 'import', changed: true })
    expect(run.rebalance?.inserted).toBeGreaterThan(0)
    expect(s.goal.projection?.end).toBeTruthy()
    expect(s.goal.baselineEnd).toBeTruthy()
    const tasks = await loadGoalTasks(run.goalId)
    expect(tasks.every((t) => t.source === 'schedule' && t.goalId === run.goalId)).toBe(true)
    // 40 h of units + 45 h + 30 h.
    expect(await minutesOf(run.goalId)).toBe((40 + 45 + 30) * 60)
  })

  it('appends new goals after the existing ones', async () => {
    const a = await runImport(parse(EXAMPLE_JSON), { kind: 'new' }, { now: NOW })
    const b = await runImport(parse(EXAMPLE_JSON), { kind: 'new' }, { now: NOW })
    expect((await snapshot(b.goalId)).goal.order).toBeGreaterThan((await snapshot(a.goalId)).goal.order)
  })

  it('undo removes the goal and its schedule but keeps the user’s own task', async () => {
    const run = await runImport(parse(EXAMPLE_JSON), { kind: 'new' }, { now: NOW })
    const mine = await createTask({ title: 'Ask my mentor about D278', goalId: run.goalId })
    expect((await loadGoalTasks(run.goalId)).length).toBeGreaterThan(1)

    await run.undo()
    expect(await loadGoalSnapshot(run.goalId)).toBeNull()
    expect(await loadGoalTasks(run.goalId)).toEqual([])
    // The task still exists, filed under nothing.
    const kept = await updateTask(mine.id, { priority: 2 })
    expect(kept?.task).toMatchObject({ title: 'Ask my mentor about D278', goalId: null, milestoneId: null })
  })
})

describe('runImport: merging into an existing goal', () => {
  const MERGE = `{"forgePlan":1,"goal":{"name":"ignored"},"courses":[
    {"code":"D278","name":"Scripting and Programming Foundations","estimatedHours":30},
    {"code":"C172","name":"Network and Security Foundations","cus":4,"type":"OA","estimatedHours":50,"prerequisites":["D278"]}
  ]}`

  async function seeded() {
    const first = await runImport(parse(EXAMPLE_JSON), { kind: 'new' }, { now: NOW })
    return { goalId: first.goalId, before: await snapshot(first.goalId) }
  }

  it('updates by code, adds new courses, and never deletes or touches the rest', async () => {
    const { goalId, before } = await seeded()
    const run = await runImport(parse(MERGE, before), { kind: 'goal', goalId }, { now: NOW })
    expect(run).toMatchObject({ mode: 'merge', wrote: true })
    expect(run.totals).toMatchObject({ courses: 2, added: 1, updated: 1 })

    const after = await snapshot(goalId)
    expect(after.goal.title).toBe(before.goal.title)
    expect(after.courses.map((c) => c.milestone.code)).toEqual(['C182', 'D278', 'C779', 'C172'])
    // D278 was updated, C182 and C779 (not in the plan, or unchanged) are exactly as they were.
    expect(after.courses[1]?.milestone.estimateHours).toBe(30)
    expect(stable(after).filter((c) => c.code === 'C182' || c.code === 'C779')).toEqual(
      stable(before).filter((c) => c.code === 'C182' || c.code === 'C779'),
    )
    const c172 = after.courses[3]?.milestone
    expect(c172).toMatchObject({ order: 3, cus: 4, courseType: 'OA', estimateHours: 50 })
    expect(c172?.prerequisiteIds).toEqual([after.courses[1]?.milestone.id])

    expect(run.rebalance?.changed).toBe(true)
    expect(await minutesOf(goalId)).toBe((40 + 30 + 30 + 50) * 60)
  })

  it('importing the same plan again writes nothing and changes no schedule', async () => {
    const { goalId, before } = await seeded()
    const again = await runImport(parse(EXAMPLE_JSON, before), { kind: 'goal', goalId }, { now: NOW })
    expect(again.wrote).toBe(false)
    expect(again.totals).toMatchObject({ added: 0, updated: 0, unchanged: 3 })
    expect(again.rebalance?.changed).toBe(false)
    expect(stable(await snapshot(goalId))).toEqual(stable(before))
  })

  it('undo restores the courses and units and re-plans the goal', async () => {
    const { goalId, before } = await seeded()
    const minutesBefore = await minutesOf(goalId)
    const withUnits = `{"forgePlan":1,"goal":{"name":"x"},"courses":[
      {"code":"C182","name":"Intro to IT","estimatedHours":40,"units":[{"title":"Databases","estimatedHours":9},{"title":"Extra unit","estimatedHours":1}]},
      {"code":"C172","name":"Network","estimatedHours":50}
    ]}`
    const run = await runImport(parse(withUnits, before), { kind: 'goal', goalId }, { now: NOW })
    const changed = await snapshot(goalId)
    expect(changed.courses).toHaveLength(4)
    expect(changed.courses[0]?.milestone.title).toBe('Intro to IT')
    expect(changed.courses[0]?.units).toHaveLength(7)
    expect(await minutesOf(goalId)).not.toBe(minutesBefore)

    await run.undo()
    expect(stable(await snapshot(goalId))).toEqual(stable(before))
    expect(await minutesOf(goalId)).toBe(minutesBefore)
  })

  it('applies goal-level changes only when the plan gives them, and undo puts them back', async () => {
    const { goalId, before } = await seeded()
    const goalChange = `{"forgePlan":1,"goal":{"name":"x","targetDate":"2027-02-15","availability":{"hoursPerWeekday":{"mon":4,"sat":2}}},"courses":[{"code":"C779","name":"Web Development Foundations","estimatedHours":30}]}`
    const run = await runImport(parse(goalChange, before), { kind: 'goal', goalId }, { now: NOW })
    const changed = await snapshot(goalId)
    expect(changed.goal).toMatchObject({
      title: before.goal.title,
      targetDate: '2027-02-15',
      availability: {
        minutesByWeekday: [0, 240, 0, 0, 0, 0, 120],
        // The plan gave no days off, so the goal's own stay.
        daysOff: before.goal.availability.daysOff,
      },
    })
    await run.undo()
    const restored = await snapshot(goalId)
    expect(restored.goal.targetDate).toBe('2027-03-31')
    expect(restored.goal.availability).toEqual(before.goal.availability)
  })

  it('refuses to merge into a goal that has been deleted', async () => {
    const { goalId, before } = await seeded()
    const gone = await runImport(parse(EXAMPLE_JSON), { kind: 'new' }, { now: NOW })
    await gone.undo()
    await expect(runImport(parse(MERGE, before), { kind: 'goal', goalId: gone.goalId })).rejects.toThrow(
      /no longer exists/,
    )
    // The failed merge wrote nothing to the other goal.
    expect(stable(await snapshot(goalId))).toEqual(stable(before))
  })

  it('is atomic: a write that fails part-way leaves no half-imported goal', async () => {
    ids.constant = 'same-id'
    try {
      // The goal row is written first; the three courses then collide on one id and abort everything.
      await expect(runImport(parse(EXAMPLE_JSON), { kind: 'new' }, { now: NOW })).rejects.toThrow()
    } finally {
      ids.constant = null
    }
    expect(await loadGoalSnapshot('same-id')).toBeNull()
    expect(await loadGoalTasks('same-id')).toEqual([])
  })
})
