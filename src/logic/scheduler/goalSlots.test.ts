// Runs with TZ=America/New_York.
import { describe, expect, it } from 'vitest'
import type { PlannedAssessment, Readiness, Task } from '@/db/types'
import { avail, goalRow, milestoneRow, taskRow, unitRow, week } from './fixtures'
import { goalAvailability, goalLivePlan, goalPlannerInput, planGoalSlots } from './goalSlots'
import { planItemFields } from './planTasks'

const MON = '2026-10-05'

function rows(
  extra: {
    tasks?: Task[]
    busy?: Task[]
    readiness?: Readiness[]
    assessments?: PlannedAssessment[]
  } = {},
) {
  return {
    goal: goalRow({
      availability: avail(week(60, 120, 0), [{ start: '2026-10-07', end: '2026-10-07' }]),
    }),
    milestones: [
      milestoneRow('a', { order: 0, status: 'active' as const }),
      milestoneRow('b', { order: 1 }),
    ],
    units: [
      unitRow('a1', 'a', 120),
      unitRow('a2', 'a', 180, { order: 1 }),
      unitRow('b1', 'b', 150),
    ],
    tasks: extra.tasks ?? [],
    busy: extra.busy ?? [],
    readiness: extra.readiness ?? [],
    plannedAssessments: extra.assessments ?? [],
    globalDaysOff: [{ start: '2026-10-08', end: '2026-10-08' }],
  }
}

describe('goalAvailability', () => {
  it('uses the planning windows, with the goal’s and the global days off as blackouts', () => {
    const r = rows()
    const av = goalAvailability(r.goal, r.globalDaysOff)
    expect(av.weekly[1]).toEqual([{ start: '09:00', end: '10:00' }])
    expect(av.sessionMinutes).toBe(50)
    expect(av.blackouts).toEqual([
      { start: '2026-10-07', end: '2026-10-07' },
      { start: '2026-10-08', end: '2026-10-08' },
    ])
  })
})

describe('planGoalSlots', () => {
  it('plans nothing on blackout days and is deterministic', () => {
    const a = planGoalSlots(rows(), MON)
    const days = a.result.items.filter((i) => i.kind === 'study').map((i) => i.doDate)
    expect(days).not.toContain('2026-10-07')
    expect(days).not.toContain('2026-10-08')
    expect(planGoalSlots(rows(), MON)).toEqual(a)
    expect(a.diff.insert.length).toBe(a.result.items.length)
  })

  it('never overlaps another task that holds a time', () => {
    const dentist = taskRow('dentist', {
      source: 'user',
      kind: 'task',
      goalId: null,
      doDate: MON,
      doTime: '09:00',
      durationMinutes: 30,
    })
    const plan = planGoalSlots(rows({ busy: [dentist] }), MON)
    const monday = plan.result.items.filter((i) => i.doDate === MON && i.kind === 'study')
    for (const i of monday) expect((i.startTime as string) >= '09:30').toBe(true)
  })

  it('counts done study toward the unit and keeps its key, and keeps a pinned session', () => {
    const first = planGoalSlots(rows(), MON).result.items.find((i) => i.key === 'a1:1')!
    const second = planGoalSlots(rows(), MON).result.items.find((i) => i.key === 'a1:2')!
    const done = taskRow('d', {
      ...planItemFields(first, 0),
      status: 'done',
      completedDay: '2026-10-04',
    })
    const pinned = taskRow('p', {
      ...planItemFields(second, 0),
      doDate: '2026-10-10',
      doTime: '10:00',
      schedulePinned: true,
    })
    const plan = planGoalSlots(rows({ tasks: [done, pinned] }), MON)
    const keys = plan.result.items.filter((i) => i.kind === 'study').map((i) => i.key)
    expect(keys).not.toContain('a1:1')
    expect(keys).not.toContain('a1:2')
    expect(plan.diff.keep).toEqual(['d', 'p'])
    expect(plan.input.pinned).toEqual([
      expect.objectContaining({ key: 'a1:2', date: '2026-10-10', startTime: '10:00' }),
    ])
  })

  it('adds readiness review time as extra reviews (the hook)', () => {
    const readiness: Readiness = {
      id: 'a1',
      createdAt: 0,
      updatedAt: 0,
      goalId: 'goal-1',
      milestoneId: 'a',
      unitId: 'a1',
      score: 0.4,
      extraReviewMinutes: 30,
      inputs: { paPct: 40, cardRetention: null, questionAccuracy: null, unitsDonePct: 0 },
      computedAt: 1,
    }
    const plan = planGoalSlots(rows({ readiness: [readiness] }), MON)
    const extra = plan.result.items.filter((i) => i.key.startsWith('extra:a1:'))
    expect(extra.map((i) => [i.kind, i.durationMinutes])).toEqual([['review', 30]])
  })

  it('treats a planned assessment as done once its item is checked off', () => {
    const exam: PlannedAssessment = {
      id: 'oa',
      createdAt: 0,
      updatedAt: 0,
      goalId: 'goal-1',
      milestoneId: 'b',
      kind: 'exam',
      title: 'Objective assessment',
      date: null,
      time: null,
      durationMinutes: null,
      status: 'planned',
      completedAt: null,
      order: 0,
      source: 'wgu',
    }
    const open = planGoalSlots(rows({ assessments: [exam] }), MON)
    const item = open.result.items.find((i) => i.key === 'assessment:oa')!
    expect(item).toMatchObject({ kind: 'assessment', assessmentId: 'oa', courseId: 'b' })
    const checked = taskRow('x', { ...planItemFields(item, 0), status: 'done' })
    const after = goalPlannerInput(rows({ assessments: [exam], tasks: [checked] }), MON)
    expect(after.input.assessments?.[0]?.done).toBe(true)
    // A finished course needs no exam either.
    const r = rows({ assessments: [exam] })
    const finished = {
      ...r,
      milestones: r.milestones.map((m) => ({ ...m, status: 'done' as const })),
    }
    expect(goalPlannerInput(finished, MON).input.assessments?.[0]?.done).toBe(true)
  })

  it('gives a roll-forward the stored plan and the accepted pace', () => {
    const plan = planGoalSlots(rows(), MON)
    const stored = plan.result.items.map((it, i) => taskRow(`t${i}`, planItemFields(it, 0)))
    const { live } = goalLivePlan(rows({ tasks: stored }), MON)
    expect(live.current).toHaveLength(stored.length)
    expect(live.paceMinutesPerStudyDay).toBeNull() // ASAP
  })

  it('says how much time a day would need to reach a target it misses', () => {
    const r = rows()
    const late = {
      ...r,
      goal: { ...r.goal, targetDate: '2026-10-09', planning: { ...r.goal.planning, asap: false } },
    }
    const plan = planGoalSlots(late, MON)
    expect(plan.projection.feasible).toBe(false)
    expect(plan.projection.slipDays).toBeGreaterThan(0)
    expect(plan.catchUp?.studyDaysLeft).toBe(3) // Mon, Tue, Fri (Wed and Thu are off)
  })
})
