import { describe, expect, it } from 'vitest'
import type { Goal, Milestone, Unit } from '@/db/types'
import { goalRow, milestoneRow, unitRow } from '@/logic/scheduler/fixtures'
import { EXAMPLE_JSON } from './example'
import { describeWeek, formatMinutes, termLabel } from './format'
import {
  DEFAULT_WEEK,
  hasWrites,
  knownCourses,
  planToOps,
  unitMinutes,
  type ExistingGoal,
} from './mapping'
import { parsePlan } from './parse'
import type { Plan } from './schema'

/** Parses like the UI does: a merge target's courses are known, so a plan may depend on them. */
function plan(text: string, target: ExistingGoal | null = null): Plan {
  const r = parsePlan(text, { known: knownCourses(target) })
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}: ${e.message}`).join('; '))
  return r.plan
}

const counter = () => {
  let n = 0
  return () => `id-${++n}`
}
const ctx = (over: Partial<{ today: string; nextGoalOrder: number }> = {}) => ({
  today: '2026-09-29',
  nextGoalOrder: 3,
  newId: counter(),
  ...over,
})

/** The example imported as a new goal, then materialised as an ExistingGoal (as the DB would return it). */
function materialise(text: string): ExistingGoal {
  const ops = planToOps(plan(text), null, ctx())
  const goal: Goal = { ...ops.goalAdd, createdAt: 1, updatedAt: 1 } as Goal
  const stamp = <T extends object>(row: T) => ({ ...row, createdAt: 1, updatedAt: 1 })
  const milestones = ops.milestonesAdd.map((m) => stamp(m) as Milestone)
  const units = ops.unitsAdd.map((u) => stamp(u) as Unit)
  return {
    goal,
    courses: milestones.map((m) => ({
      milestone: m,
      units: units.filter((u) => u.milestoneId === m.id),
    })),
  }
}

describe('planToOps: new goal', () => {
  const ops = planToOps(plan(EXAMPLE_JSON), null, ctx())

  it('maps the goal, its term and availability', () => {
    expect(ops.mode).toBe('create')
    expect(ops.goalChanges).toBeNull()
    expect(ops.goalAdd).toMatchObject({
      id: ops.goalId,
      title: 'B.S. Computer Science — WGU',
      icon: '🎓',
      kind: 'degree',
      status: 'active',
      startDate: '2026-10-01',
      targetDate: '2027-03-31',
      order: 3,
      // Sunday first: sun 0, mon–thu 2 h, fri 1 h, sat 3 h.
      availability: {
        minutesByWeekday: [0, 120, 120, 120, 120, 60, 180],
        daysOff: [{ start: '2026-12-24', end: '2026-12-26' }],
      },
      terms: [{ label: 'Oct 2026 – Mar 2027', start: '2026-10-01', end: '2027-03-31' }],
      baselineEnd: null,
      projection: null,
    })
  })

  it('maps courses with WGU fields, in order, linked to the term and to each other', () => {
    const [c182, d278, c779] = ops.milestonesAdd
    const termId = ops.goalAdd?.terms[0]?.id
    expect([c182?.code, d278?.code, c779?.code]).toEqual(['C182', 'D278', 'C779'])
    expect([c182?.order, d278?.order, c779?.order]).toEqual([0, 1, 2])
    expect(c182).toMatchObject({
      goalId: ops.goalId,
      kind: 'course',
      title: 'Introduction to IT',
      cus: 4,
      courseType: 'OA',
      estimateHours: 40,
      status: 'todo',
      dueDate: null,
      prerequisiteIds: [],
      termId,
    })
    expect(c779?.courseType).toBe('PA')
    expect(d278?.dueDate).toBe('2026-12-15')
    expect(d278?.prerequisiteIds).toEqual([c182?.id])
    expect(c779?.prerequisiteIds).toEqual([c182?.id])
  })

  it('maps units in order, hours and minutes to whole minutes', () => {
    const c182 = ops.milestonesAdd[0]
    const units = ops.unitsAdd.filter((u) => u.milestoneId === c182?.id)
    expect(units.map((u) => [u.title, u.order, u.estimateMinutes])).toEqual([
      ['Hardware and operating systems', 0, 360],
      ['Networks and the internet', 1, 420],
      ['Programming and scripting concepts', 2, 360],
      ['Cloud and virtualization', 3, 420],
      ['Databases', 4, 420],
      ['Security and ethics', 5, 420],
    ])
    expect(units.every((u) => u.goalId === ops.goalId && u.status === 'todo')).toBe(true)
  })

  it('previews the courses, totals and does not store assessments', () => {
    expect(ops.preview.totals).toMatchObject({
      courses: 3,
      added: 3,
      updated: 0,
      unchanged: 0,
      hours: 115,
      cus: 11,
      units: 6,
      assessments: 2,
    })
    expect(ops.preview.courses[1]).toMatchObject({
      code: 'D278',
      cus: 4,
      type: 'OA',
      hours: 45,
      unitCount: 0,
      prerequisites: ['C182'],
      change: 'new',
    })
    expect(ops.preview.goal).toMatchObject({
      availability: 'Mon–Thu 2 h · Fri 1 h · Sat 3 h · Sun off',
      weeklyHours: '12 h',
      availabilityIsDefault: false,
      term: { label: 'Oct 2026 – Mar 2027' },
    })
    // Nothing anywhere in the rows about assessments.
    expect(JSON.stringify(ops)).not.toMatch(/Objective assessment|Web page project/)
  })

  it('falls back to a default week, today as the start and the term end as the target', () => {
    const minimal = planToOps(
      plan('{"forgePlan":1,"goal":{"name":"Cert"},"courses":[{"code":"X1","name":"X","estimatedHours":10}]}'),
      null,
      ctx(),
    )
    expect(minimal.goalAdd).toMatchObject({
      icon: '🎓',
      kind: 'custom',
      startDate: '2026-09-29',
      targetDate: null,
      terms: [],
      availability: { minutesByWeekday: DEFAULT_WEEK, daysOff: [] },
    })
    expect(minimal.milestonesAdd[0]).toMatchObject({ termId: null, cus: null, courseType: null })
    expect(minimal.preview.goal.availabilityIsDefault).toBe(true)

    const termOnly = planToOps(
      plan(
        '{"forgePlan":1,"goal":{"name":"T","term":{"start":"2026-10-01","end":"2027-03-31"}},"courses":[{"code":"X1","name":"X","estimatedHours":10}]}',
      ),
      null,
      ctx(),
    )
    expect(termOnly.goalAdd?.targetDate).toBe('2027-03-31')
  })

  it('ranks courses by `order` and leaves a course due after the term out of it', () => {
    const p = plan(
      `{"forgePlan":1,"goal":{"name":"G","term":{"start":"2026-10-01","end":"2027-03-31"}},"courses":[
        {"code":"A","name":"A","estimatedHours":1,"order":2},
        {"code":"B","name":"B","estimatedHours":1,"order":1},
        {"code":"C","name":"C","estimatedHours":1,"targetDate":"2027-06-30"}
      ]}`,
    )
    const o = planToOps(p, null, ctx())
    const byCode = Object.fromEntries(o.milestonesAdd.map((m) => [m.code, m]))
    // C has no order, so it ranks at its list position (2), tied with A: list order breaks the tie.
    expect([byCode.B?.order, byCode.A?.order, byCode.C?.order]).toEqual([0, 1, 2])
    expect(byCode.A?.termId).not.toBeNull()
    expect(byCode.C?.termId).toBeNull()
  })

  it('never loses a unit with only a title (estimate stays null for the scheduler to share hours)', () => {
    const o = planToOps(
      plan('{"forgePlan":1,"goal":{"name":"G"},"courses":[{"code":"A","name":"A","estimatedHours":9,"units":[{"title":"One"},{"title":"Two","estimatedMinutes":1}]}]}'),
      null,
      ctx(),
    )
    expect(o.unitsAdd.map((u) => u.estimateMinutes)).toEqual([null, 1])
  })
})

describe('planToOps: merge into an existing goal', () => {
  const existing = materialise(EXAMPLE_JSON)
  const merge = (json: string, target: ExistingGoal = existing) =>
    planToOps(plan(json, target), target, ctx())

  it('is idempotent: importing the same plan again writes nothing', () => {
    const again = planToOps(plan(EXAMPLE_JSON, existing), existing, ctx())
    expect(again.mode).toBe('merge')
    expect(hasWrites(again)).toBe(false)
    expect(again.preview.totals).toMatchObject({ added: 0, updated: 0, unchanged: 3 })
    expect(again.preview.goalChanges).toEqual([])
  })

  it('updates a course by code, changing only what the plan gives', () => {
    const o = merge(
      '{"forgePlan":1,"goal":{"name":"Renamed"},"courses":[{"code":"c182","name":"Intro to IT","estimatedHours":44}]}',
    )
    expect(o.milestonesAdd).toEqual([])
    expect(o.milestonesUpdate).toHaveLength(1)
    // cus, type, prerequisites, term and due date were not given, so they are not touched.
    expect(o.milestonesUpdate[0]?.changes).toEqual({ title: 'Intro to IT', estimateHours: 44 })
    expect(o.milestonesUpdate[0]?.id).toBe(existing.courses[0]?.milestone.id)
    expect(o.preview.courses[0]).toMatchObject({ change: 'update', changed: ['name', 'hours'] })
    // The goal keeps its name; nothing else on it changed.
    expect(o.goalChanges).toBeNull()
    expect(o.goalAdd).toBeNull()
    expect(o.preview.goal.title).toBe('B.S. Computer Science — WGU')
  })

  it('adds new courses after the last one and never deletes the ones the plan leaves out', () => {
    const o = merge(
      '{"forgePlan":1,"goal":{"name":"G"},"courses":[{"code":"C172","name":"Network and Security Foundations","cus":4,"type":"OA","estimatedHours":50,"prerequisites":["D278"]},{"code":"C959","name":"Discrete Mathematics I","estimatedHours":45,"order":0}]}',
    )
    expect(o.milestonesAdd.map((m) => [m.code, m.order])).toEqual([
      ['C172', 3],
      ['C959', 4],
    ])
    // C959 asked for order 0 but ranks first among the new ones only: existing courses keep their place.
    expect(o.milestonesAdd[0]?.prerequisiteIds).toEqual([existing.courses[1]?.milestone.id])
    expect(o.milestonesUpdate).toEqual([])
    expect(o.preview.totals).toMatchObject({ added: 2, updated: 0 })
    // There is no way to express a deletion in the ops.
    expect(Object.keys(o)).not.toContain('milestonesDelete')
    expect(o.preview.goalChanges).toEqual([])
  })

  it('matches units by title: updates estimates, appends new ones, keeps the rest', () => {
    const o = merge(
      '{"forgePlan":1,"goal":{"name":"G"},"courses":[{"code":"C182","name":"Introduction to IT","estimatedHours":40,"units":[{"title":" databases ","estimatedHours":8},{"title":"Cloud and virtualization","estimatedHours":7},{"title":"Emerging topics","estimatedHours":2}]}]}',
    )
    const units = existing.courses[0]?.units ?? []
    const databases = units.find((u) => u.title === 'Databases')
    expect(o.unitsUpdate).toEqual([
      {
        id: databases?.id,
        changes: { estimateMinutes: 480, baseEstimateMinutes: 480, estimateSource: 'import' },
      },
    ])
    expect(o.unitsAdd).toHaveLength(1)
    expect(o.unitsAdd[0]).toMatchObject({
      title: 'Emerging topics',
      order: 6,
      estimateMinutes: 120,
      milestoneId: existing.courses[0]?.milestone.id,
    })
    expect(o.preview.courses[0]).toMatchObject({ change: 'update', unitsAdded: 1, unitsUpdated: 1, changed: [] })
    expect(o.milestonesUpdate).toEqual([])
  })

  it('applies target date, a new term and availability only when given, and describes them', () => {
    const o = merge(
      `{"forgePlan":1,"goal":{"name":"x","targetDate":"2027-02-15","term":{"start":"2027-04-01","end":"2027-09-30"},"availability":{"hoursPerWeekday":{"mon":3,"tue":3}}},"courses":[{"code":"D278","name":"Scripting and Programming Foundations","estimatedHours":45,"targetDate":"2027-05-01"}]}`,
    )
    expect(o.goalChanges).toMatchObject({
      targetDate: '2027-02-15',
      // The plan gave no days off, so the goal's stay.
      availability: {
        minutesByWeekday: [0, 180, 180, 0, 0, 0, 0],
        daysOff: [{ start: '2026-12-24', end: '2026-12-26' }],
      },
    })
    expect(o.goalChanges?.terms).toHaveLength(2)
    expect(o.goalChanges?.terms?.[1]).toMatchObject({ label: 'Apr 2027 – Sep 2027' })
    expect(o.preview.goalChanges).toEqual([
      'Target date 2027-03-31 → 2027-02-15',
      'Term added: Apr 2027 – Sep 2027',
      'Availability: Mon–Tue 3 h · Wed–Sun off',
    ])
    // D278 is due within the new term, so it moves into it; its due date changes.
    expect(o.milestonesUpdate[0]?.changes).toMatchObject({ dueDate: '2027-05-01' })
    expect(o.milestonesUpdate[0]?.changes.termId).toBe(o.goalChanges?.terms?.[1]?.id)
  })

  it('reuses a term with the same dates instead of adding a copy', () => {
    const o = merge(EXAMPLE_JSON.replace('"targetDate": "2027-03-31"', '"targetDate": "2027-03-31"'))
    expect(o.goalChanges).toBeNull()
    expect(existing.goal.terms).toHaveLength(1)
  })

  it('links prerequisites to courses of the goal that the plan does not contain', () => {
    const o = merge(
      '{"forgePlan":1,"goal":{"name":"G"},"courses":[{"code":"C172","name":"Network","estimatedHours":50,"prerequisites":["c182","D278"]}]}',
    )
    expect(o.milestonesAdd[0]?.prerequisiteIds).toEqual([
      existing.courses[0]?.milestone.id,
      existing.courses[1]?.milestone.id,
    ])
  })

  it('updates prerequisites when the plan gives them, and clears them with an empty list', () => {
    const o = merge(
      '{"forgePlan":1,"goal":{"name":"G"},"courses":[{"code":"D278","name":"Scripting and Programming Foundations","estimatedHours":45,"prerequisites":[]}]}',
    )
    expect(o.milestonesUpdate[0]?.changes).toEqual({ prerequisiteIds: [] })
    expect(o.preview.courses[0]).toMatchObject({ change: 'update', changed: ['prerequisites'] })
  })

  it('leaves a completed course’s status and progress alone', () => {
    const done = milestoneRow('c182', { code: 'C182', status: 'done', title: 'Introduction to IT', estimateHours: 40, completedAt: 5 })
    const goal: Goal = goalRow()
    const target: ExistingGoal = {
      goal,
      courses: [{ milestone: done, units: [unitRow('u1', 'c182', 60, { title: 'Databases', status: 'done', completedAt: 9 })] }],
    }
    const o = planToOps(
      plan(
        '{"forgePlan":1,"goal":{"name":"G"},"courses":[{"code":"C182","name":"Introduction to IT","estimatedHours":50,"units":[{"title":"Databases","estimatedHours":2}]}]}',
        target,
      ),
      target,
      ctx(),
    )
    expect(o.milestonesUpdate[0]?.changes).toEqual({ estimateHours: 50 })
    expect(o.unitsUpdate[0]?.changes).toEqual({
      estimateMinutes: 120,
      baseEstimateMinutes: 120,
      estimateSource: 'import',
    })
    expect(JSON.stringify(o)).not.toMatch(/"status"|completedAt/)
  })
})

describe('knownCourses', () => {
  it('lists the goal’s coded courses with their prerequisites as codes', () => {
    const existing = materialise(EXAMPLE_JSON)
    expect(knownCourses(existing)).toEqual([
      { code: 'C182', prerequisites: [] },
      { code: 'D278', prerequisites: ['C182'] },
      { code: 'C779', prerequisites: ['C182'] },
    ])
    expect(knownCourses(null)).toEqual([])
  })

  it('lets a plan depend on them but still rejects a cycle through them', () => {
    const existing = materialise(EXAMPLE_JSON)
    const known = knownCourses(existing)
    const dependsOnExisting =
      '{"forgePlan":1,"goal":{"name":"G"},"courses":[{"code":"C172","name":"N","estimatedHours":5,"prerequisites":["D278"]}]}'
    expect(parsePlan(dependsOnExisting).ok).toBe(false)
    expect(parsePlan(dependsOnExisting, { known }).ok).toBe(true)

    // D278 already needs C182; making C182 need D278 closes a loop through a course the plan does not list.
    const cycle =
      '{"forgePlan":1,"goal":{"name":"G"},"courses":[{"code":"C182","name":"Introduction to IT","estimatedHours":40,"prerequisites":["D278"]}]}'
    const r = parsePlan(cycle, { known })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]?.message).toMatch(/closes a prerequisite cycle: C182 needs D278 needs C182/)
  })
})

describe('helpers', () => {
  it('unitMinutes rounds to whole minutes and never returns 0', () => {
    expect(unitMinutes({ title: 'a', estimatedHours: 1.5 })).toBe(90)
    expect(unitMinutes({ title: 'a', estimatedMinutes: 20.4 })).toBe(20)
    expect(unitMinutes({ title: 'a', estimatedHours: 0.001 })).toBe(1)
    expect(unitMinutes({ title: 'a' })).toBeNull()
  })

  it('formats hours, weeks and terms', () => {
    expect(formatMinutes(120)).toBe('2 h')
    expect(formatMinutes(90)).toBe('1.5 h')
    expect(formatMinutes(45)).toBe('45 min')
    expect(describeWeek(DEFAULT_WEEK)).toBe('Mon–Fri 2 h · Sat–Sun off')
    expect(describeWeek([60, 60, 60, 60, 60, 60, 60])).toBe('Mon–Sun 1 h')
    expect(termLabel('2026-10-01', '2027-03-31')).toBe('Oct 2026 – Mar 2027')
    expect(termLabel('2026-10-01', '2026-10-31')).toBe('Oct 2026')
  })
})
