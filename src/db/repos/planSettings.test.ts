import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { resetDomainEvents, settleDomainEvents } from '@/db/events'
import { createGoalWithCourses, trashGoal } from '@/db/repos/goals'
import { savePlanSettings } from '@/db/repos/planSettings'
import { atTime } from '@/logic/dates'
import { templateById } from '@/logic/goalTemplates'
import { toGoalAvailability } from '@/logic/plannerAvailability'
import {
  applyParse,
  applyTemplate,
  emptyPlannerDraft,
  plannerRows,
  withAddedTime,
} from '@/logic/plannerDraft'
import { parsePlanText } from '@/logic/planParse'

const TODAY = '2026-10-05'
const NOW = atTime(TODAY, '08:00')

let n = 0
const keys = () => `k${++n}`
const ids = () => `id${++n}`

beforeEach(async () => {
  resetDomainEvents()
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

describe('creating a planned goal', () => {
  it('saves the goal, courses, units and planned assessments in one go and plans it', async () => {
    const draft = applyTemplate(emptyPlannerDraft(TODAY), templateById('certification'), {
      newKey: keys,
      today: TODAY,
    })
    const rows = plannerRows(draft, { today: TODAY, now: NOW, newId: ids })
    const created = await createGoalWithCourses(rows, { now: NOW })
    expect(created.planError).toBeNull()
    expect(await db.milestones.where('goalId').equals(created.goal.id).count()).toBe(6)
    expect(await db.units.where('goalId').equals(created.goal.id).count()).toBe(
      draft.courses.reduce((s, c) => s + c.units.length, 0),
    )
    const assessments = await db.plannedAssessments.where('goalId').equals(created.goal.id).toArray()
    expect(assessments.map((a) => a.kind).sort()).toEqual(['exam', 'quiz'])
    expect(created.goal.planning.asap).toBe(false)
    expect(created.goal.baselineEnd).not.toBeNull()
    expect(created.goal.projection?.feasible).toBe(true)
    expect(await db.tasks.where('goalId').equals(created.goal.id).count()).toBeGreaterThan(30)
  })

  it('refuses an assessment that belongs to another goal, writing nothing', async () => {
    const draft = applyTemplate(emptyPlannerDraft(TODAY), templateById('personal-project'), {
      newKey: keys,
      today: TODAY,
    })
    const rows = plannerRows(draft, { today: TODAY, now: NOW, newId: ids })
    const [a] = rows.plannedAssessments
    await expect(
      createGoalWithCourses({
        ...rows,
        plannedAssessments: [{ ...(a as NonNullable<typeof a>), goalId: 'other' }],
      }),
    ).rejects.toThrow('planned assessment')
    expect(await db.goals.count()).toBe(0)
  })

  it('can be undone by trashing the goal', async () => {
    const draft = applyTemplate(emptyPlannerDraft(TODAY), templateById('personal-project'), {
      newKey: keys,
      today: TODAY,
    })
    const created = await createGoalWithCourses(
      plannerRows(draft, { today: TODAY, now: NOW, newId: ids }),
      { now: NOW },
    )
    const trashed = await trashGoal(created.goal.id, { now: NOW })
    expect(await db.goals.count()).toBe(0)
    expect(await db.plannedAssessments.count()).toBe(0)
    await trashed?.undo()
    expect(await db.goals.count()).toBe(1)
    expect(await db.plannedAssessments.count()).toBe(1)
  })
})

describe('savePlanSettings', () => {
  async function seed() {
    const draft = applyTemplate(emptyPlannerDraft(TODAY), templateById('personal-project'), {
      newKey: keys,
      today: TODAY,
    })
    const created = await createGoalWithCourses(
      plannerRows(draft, { today: TODAY, now: NOW, newId: ids }),
      { now: NOW },
    )
    return { draft, goal: created.goal }
  }

  it('saves windows, buffer and finish, and re-plans', async () => {
    const { draft, goal } = await seed()
    const stored = toGoalAvailability(withAddedTime(draft, 30).availability)
    const saved = await savePlanSettings(
      goal.id,
      {
        targetDate: '2026-12-15',
        asap: false,
        availability: stored.availability,
        planning: stored.planning,
        bufferPct: 0.15,
        cuHoursMultiplier: 15,
      },
      { now: NOW },
    )
    expect(saved?.planError).toBeNull()
    expect(saved?.goal.targetDate).toBe('2026-12-15')
    expect(saved?.goal.planning.bufferPct).toBe(0.15)
    expect(saved?.goal.planning.weekly[2]).toEqual([{ start: '19:00', end: '21:30' }])
    expect(saved?.summary?.reason).toBe('edit')
    expect(saved?.goal.availability.minutesByWeekday[2]).toBe(150)
  })

  it('goes ASAP by clearing the target', async () => {
    const { draft, goal } = await seed()
    const stored = toGoalAvailability(draft.availability)
    const saved = await savePlanSettings(
      goal.id,
      { targetDate: null, asap: true, availability: stored.availability, planning: stored.planning, bufferPct: 0.12, cuHoursMultiplier: 15 },
      { now: NOW },
    )
    expect(saved?.goal.targetDate).toBeNull()
    expect(saved?.goal.planning.asap).toBe(true)
  })

  it('rescales CU-derived estimates when the multiplier changes, and leaves typed ones alone', async () => {
    const parsed = applyParse(
      emptyPlannerDraft(TODAY),
      parsePlanText('C182 Introduction to IT – 4 CUs OA\nUnit A\nUnit B', { today: TODAY }),
      { source: 'paste', newKey: keys, today: TODAY },
    )
    const draft = { ...parsed, targetDate: '2027-03-01' as const }
    const created = await createGoalWithCourses(
      plannerRows(draft, { today: TODAY, now: NOW, newId: ids }),
      { now: NOW },
    )
    const before = await db.units.where('goalId').equals(created.goal.id).toArray()
    expect(before.reduce((s, u) => s + (u.estimateMinutes ?? 0), 0)).toBe(3600)
    const stored = toGoalAvailability(draft.availability)
    await savePlanSettings(
      created.goal.id,
      { targetDate: '2027-03-01', asap: false, availability: stored.availability, planning: stored.planning, bufferPct: 0.12, cuHoursMultiplier: 10 },
      { now: NOW },
    )
    const after = await db.units.where('goalId').equals(created.goal.id).toArray()
    expect(after.reduce((s, u) => s + (u.estimateMinutes ?? 0), 0)).toBe(2400)
  })

  it('returns null for a missing goal', async () => {
    const stored = toGoalAvailability(emptyPlannerDraft(TODAY).availability)
    expect(
      await savePlanSettings('nope', { targetDate: null, asap: true, availability: stored.availability, planning: stored.planning, bufferPct: 0.1, cuHoursMultiplier: 15 }),
    ).toBeNull()
  })
})
