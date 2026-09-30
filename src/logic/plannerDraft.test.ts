import { describe, expect, it } from 'vitest'
import { parsePlanText } from './planParse'
import { checkFeasibility } from './scheduler'
import { templateById } from './goalTemplates'
import {
  applyParse,
  applyPlanDraft,
  applyTemplate,
  coursesWithoutEffort,
  draftEffort,
  emptyPlannerDraft,
  fillBlankUnits,
  firstInvalidStep,
  initialPlannerState,
  plannerReducer,
  plannerRows,
  planStats,
  previewPlanner,
  validatePlannerStep,
  withAddedTime,
  withoutUnitKeys,
  withTargetDate,
  type PlannerDraft,
  type PlannerState,
} from './plannerDraft'
import { serializePlanner, restorePlanner } from './plannerPersist'

const TODAY = '2026-09-29'
const keys = () => {
  let n = 0
  return () => `k${++n}`
}

const WGU_LIST = `WGU B.S. Computer Science, Term 1
C182 Introduction to IT – 4 CUs OA
C779 Web Development Foundations (3 CUs) PA
D278 Scripting and Programming Foundations (3 CU) OA
Target: December 18, 2026
`

function parsed(text = WGU_LIST): PlannerDraft {
  const r = parsePlanText(text, { today: TODAY })
  return applyParse(emptyPlannerDraft(TODAY), r, { source: 'paste', newKey: keys(), today: TODAY })
}

const run = (state: PlannerState, ...actions: Parameters<typeof plannerReducer>[1][]) =>
  actions.reduce(plannerReducer, state)

describe('filling the draft', () => {
  it('turns a pasted WGU list into courses with CUs, types and assessments', () => {
    const d = parsed()
    expect(d.title).toBe('WGU B.S. Computer Science, Term 1')
    expect(d.courses.map((c) => c.code)).toEqual(['C182', 'C779', 'D278'])
    expect(d.courses.map((c) => c.cus)).toEqual([4, 3, 3])
    expect(d.courses[0]?.effortBy).toBe('cus')
    expect(d.courses.map((c) => c.assessments.map((a) => a.kind))).toEqual([['exam'], ['project'], ['exam']])
    expect(d.targetDate).toBe('2026-12-18')
    expect(d.kind).toBe('degree')
  })

  it('keeps unparsed lines and the breakdown flag for the review screen', () => {
    const d = parsed('Learn conversational Spanish by June 2027')
    expect(d.needsBreakdown).toBe(true)
    expect(d.courses).toHaveLength(1)
    const withJunk = parsed('C182 Introduction to IT (4 CUs)\n???? scribble here')
    expect(withJunk.unparsed.map((u) => u.text)).toEqual(['???? scribble here'])
  })

  it('maps prerequisites by course code, only to earlier courses', () => {
    const d = applyPlanDraft(
      emptyPlannerDraft(TODAY),
      {
        goal: { title: 'T' },
        courses: [
          { code: 'C867', title: 'Apps', prerequisites: ['D278'], units: [], assessments: [] },
          { code: 'D278', title: 'Scripting', units: [], assessments: [] },
        ],
      },
      { source: 'claude', newKey: keys(), today: TODAY },
    )
    expect(d.courses[0]?.prerequisiteKeys).toEqual([])
  })

  it('applies a template: its courses, windows, finish and term', () => {
    const d = applyTemplate(emptyPlannerDraft(TODAY), templateById('wgu-term'), { newKey: keys(), today: TODAY })
    expect(d.courses).toHaveLength(7)
    expect(d.templateId).toBe('wgu-term')
    expect(d.targetDate).toBe('2027-03-28')
    expect(d.wguTerm).toBe(true)
    expect(d.availability.weekly[6]).toEqual([{ start: '09:00', end: '13:00' }])
    expect(d.courses[6]?.prerequisiteKeys).toEqual([d.courses[2]?.key])
  })
})

describe('effort', () => {
  it('shows minutes from CUs times the multiplier, adjusted by the self-rating', () => {
    const d = parsed()
    const [c182] = draftEffort(d).courses
    expect(c182?.totalMinutes).toBe(4 * 15 * 60)
    const know = { ...d, courses: d.courses.map((c) => ({ ...c, rating: 'know' as const })) }
    expect(draftEffort(know).courses[0]?.totalMinutes).toBe(4 * 15 * 30)
    expect(draftEffort({ ...d, cuMultiplier: 10 }).courses[0]?.totalMinutes).toBe(2400)
  })

  it('reports courses with nothing to schedule and can fill blank units', () => {
    const d = parsed('Week 1: Intro\nWeek 2: Loops\nWeek 3: Functions')
    expect(coursesWithoutEffort(d)).toHaveLength(1)
    expect(validatePlannerStep(d, 3, TODAY)).not.toEqual({})
    const filled = fillBlankUnits(d, 3)
    expect(coursesWithoutEffort(filled)).toHaveLength(0)
    expect(draftEffort(filled).totalMinutes).toBe(3 * 3 * 60)
  })
})

describe('reducer', () => {
  const base = (): PlannerState => ({
    ...initialPlannerState(TODAY),
    draft: applyTemplate(emptyPlannerDraft(TODAY), templateById('wgu-term'), { newKey: keys(), today: TODAY }),
  })

  it('edits, reorders and deletes courses and units', () => {
    let s = base()
    const [a, b] = s.draft.courses
    s = run(s, { type: 'reorderCourses', keys: [b?.key ?? '', a?.key ?? ''] })
    expect(s.draft.courses.slice(0, 2).map((c) => c.code)).toEqual(['C779', 'C182'])
    const first = s.draft.courses[0]
    s = run(s, { type: 'patchUnit', courseKey: first?.key ?? '', key: first?.units[0]?.key ?? '', patch: { title: 'HTML basics', minutes: 180 } })
    expect(s.draft.courses[0]?.units[0]).toMatchObject({ title: 'HTML basics', minutes: 180 })
    s = run(s, { type: 'removeCourse', key: first?.key ?? '' })
    expect(s.draft.courses).toHaveLength(6)
  })

  it('deleting a unit takes its hours off the course instead of spreading them', () => {
    let s = base()
    const c182 = s.draft.courses[0]
    expect(draftEffort(s.draft).courses[0]?.totalMinutes).toBe(2400)
    s = run(s, { type: 'removeUnit', courseKey: c182?.key ?? '', key: c182?.units[0]?.key ?? '' })
    expect(s.draft.courses[0]?.units).toHaveLength(5)
    expect(draftEffort(s.draft).courses[0]?.totalMinutes).toBe(2000)
    // Undo puts the course back as it was.
    s = run(s, { type: 'replaceCourse', course: c182 ?? s.draft.courses[0]! })
    expect(draftEffort(s.draft).courses[0]?.totalMinutes).toBe(2400)
  })

  it('turns an unreadable line into a unit, or into a course when there is none', () => {
    const d = parsed('C182 Intro (4 CUs)\n???? Cloud storage notes')
    let s: PlannerState = { ...initialPlannerState(TODAY), draft: d }
    s = run(s, { type: 'unparsedToUnit', line: d.unparsed[0]?.line ?? 0, courseKey: null, courseKeyNew: 'nc', unitKey: 'nu' })
    expect(s.draft.unparsed).toEqual([])
    expect(s.draft.courses[0]?.units.map((u) => u.title)).toEqual(['???? Cloud storage notes'])
    const bare: PlannerState = {
      ...initialPlannerState(TODAY),
      draft: { ...emptyPlannerDraft(TODAY), title: 'Read', unparsed: [{ line: 1, text: 'Chapter one' }] },
    }
    const next = run(bare, { type: 'unparsedToUnit', line: 1, courseKey: null, courseKeyNew: 'nc', unitKey: 'nu' })
    expect(next.draft.courses[0]?.units[0]?.title).toBe('Chapter one')
  })

  it('setting a course rating applies to its units', () => {
    let s = base()
    const c = s.draft.courses[0]
    s = run(s, { type: 'patchUnit', courseKey: c?.key ?? '', key: c?.units[0]?.key ?? '', patch: { rating: 'know' } })
    s = run(s, { type: 'setCourseRating', courseKey: c?.key ?? '', rating: 'somewhat' })
    expect(s.draft.courses[0]?.units.every((u) => u.rating === null)).toBe(true)
    expect(s.draft.courses[0]?.rating).toBe('somewhat')
  })

  it('tracks the furthest step reached', () => {
    let s = initialPlannerState(TODAY)
    s = run(s, { type: 'go', step: 3 }, { type: 'go', step: 1 })
    expect(s).toMatchObject({ step: 1, reached: 3 })
  })
})

describe('validation', () => {
  it('asks for content, a finish date and windows in order', () => {
    const d = emptyPlannerDraft(TODAY)
    expect(validatePlannerStep(d, 0, TODAY).courses).toBeTruthy()
    expect(firstInvalidStep(d, TODAY)).toBe(0)
    const c = parsed()
    expect(validatePlannerStep({ ...c, targetDate: null }, 1, TODAY).targetDate).toBeTruthy()
    expect(validatePlannerStep({ ...c, targetMode: 'asap', targetDate: null }, 1, TODAY)).toEqual({})
    expect(validatePlannerStep({ ...c, startDate: '2026-01-01' }, 1, TODAY).startDate).toBeTruthy()
    expect(validatePlannerStep({ ...c, targetDate: TODAY }, 1, TODAY).targetDate).toBeTruthy()
    expect(validatePlannerStep({ ...c, title: ' ' }, 4, TODAY).title).toBeTruthy()
  })
})

describe('rows and preview', () => {
  const tpl = () =>
    applyTemplate(emptyPlannerDraft(TODAY), templateById('wgu-term'), { newKey: keys(), today: TODAY })

  it('saves a goal with planning, courses, units, planned assessments and a term', () => {
    let n = 0
    const rows = plannerRows(tpl(), { today: TODAY, now: 1, newId: () => `id${++n}` })
    expect(rows.goal.planning).toMatchObject({ sessionMinutes: 50, bufferPct: 0.12, cuHoursMultiplier: 15, asap: false })
    expect(rows.goal.planning.weekly[1]).toEqual([{ start: '18:00', end: '21:00' }])
    expect(rows.goal.availability.minutesByWeekday[1]).toBe(180)
    expect(rows.goal.targetDate).toBe('2027-03-28')
    expect(rows.goal.terms).toHaveLength(1)
    expect(rows.milestones).toHaveLength(7)
    expect(rows.milestones.every((m) => m.termId === rows.goal.terms[0]?.id)).toBe(true)
    expect(rows.units).toHaveLength(37)
    expect(rows.plannedAssessments).toHaveLength(7)
    expect(rows.plannedAssessments.every((a) => rows.milestones.some((m) => m.id === a.milestoneId))).toBe(true)
    expect(rows.milestones[6]?.prerequisiteIds).toEqual([rows.milestones[2]?.id])
    // 310 h of study in all, from the units.
    expect(rows.units.reduce((s, u) => s + (u.estimateMinutes ?? 0), 0)).toBe(310 * 60)
    expect(new Set([rows.goal.id, ...rows.milestones.map((m) => m.id), ...rows.units.map((u) => u.id)]).size).toBe(45)
  })

  it('carries the self-rating into the unit estimate', () => {
    const d = tpl()
    const rated = { ...d, courses: d.courses.map((c, i) => (i === 0 ? { ...c, rating: 'know' as const } : c)) }
    const rows = plannerRows(rated, { today: TODAY, now: 1, newId: () => 'x', useKeys: true })
    const c182Units = rows.units.filter((u) => u.milestoneId === rated.courses[0]?.key)
    expect(c182Units.reduce((s, u) => s + (u.estimateMinutes ?? 0), 0)).toBe(1200)
    expect(c182Units[0]).toMatchObject({ selfRating: 'know', baseEstimateMinutes: 400, estimateSource: 'course' })
  })

  it('a course without units becomes one block of its hours', () => {
    const d = parsed('C182 Introduction to IT – 40 hours')
    const rows = plannerRows({ ...d, targetDate: '2027-01-31' }, { today: TODAY, now: 1, newId: () => 'x', useKeys: true })
    expect(rows.units).toHaveLength(0)
    const plan = previewPlanner({ ...d, targetDate: '2027-01-31' }, TODAY)
    expect(plan.result.totals.study).toBe(2400)
  })

  it('previews the same plan the repo would build, with counts and pace', () => {
    const plan = previewPlanner(tpl(), TODAY)
    expect(plan.result.fits).toBe(true)
    const stats = planStats(plan, TODAY)
    expect(stats.sessions).toBeGreaterThan(300)
    expect(stats.reviews).toBeGreaterThan(0)
    expect(stats.practiceTests).toBeGreaterThan(0)
    expect(stats.milestones).toBeGreaterThan(20)
    expect(stats.hoursPerWeek).toBeGreaterThan(10)
    expect(stats.bufferPct).toBe(0.12)
  })

  it('asap mode has no target and no term', () => {
    const rows = plannerRows({ ...tpl(), targetMode: 'asap' }, { today: TODAY, now: 1, newId: () => 'x', useKeys: true })
    expect(rows.goal.targetDate).toBeNull()
    expect(rows.goal.planning.asap).toBe(true)
    expect(rows.goal.terms).toEqual([])
  })
})

describe('when it does not fit', () => {
  // Three WGU courses in two months on evenings only: too tight.
  function tight(): PlannerDraft {
    const d = applyTemplate(emptyPlannerDraft(TODAY), templateById('wgu-term'), { newKey: keys(), today: TODAY })
    return {
      ...d,
      courses: d.courses.slice(0, 4).map((c, i) => (i === 3 ? { ...c, units: c.units.map((u) => ({ ...u, optional: true })) } : c)),
      targetDate: '2026-11-30',
      availability: { ...d.availability, weekly: d.availability.weekly.map((_ws, day) => (day >= 1 && day <= 5 ? [{ start: '19:00' as const, end: '20:30' as const }] : [])) },
    }
  }

  it('offers three options, each verified by re-running the plan', () => {
    const d = tight()
    const plan = previewPlanner(d, TODAY)
    expect(plan.result.fits).toBe(false)
    const f = checkFeasibility(plan.input)
    expect(f.fits).toBe(false)
    const { addTime, moveDate, cutScope } = f.options

    if (addTime.extraMinutesPerStudyDay !== null) {
      expect(previewPlanner(withAddedTime(d, addTime.extraMinutesPerStudyDay), TODAY).result.fits).toBe(true)
    }
    expect(moveDate.earliestFeasibleDate).not.toBeNull()
    expect(previewPlanner(withTargetDate(d, moveDate.earliestFeasibleDate as string), TODAY).result.fits).toBe(true)
    if (cutScope.suggestedCut.length > 0) {
      expect(previewPlanner(withoutUnitKeys(d, cutScope.suggestedCut), TODAY).result.fits).toBe(true)
    }
    expect(cutScope.candidates.filter((c) => c.reason === 'optional').length).toBeGreaterThan(0)
  })

  it('cutting units removes their hours, and a course with no units left', () => {
    const d = applyTemplate(emptyPlannerDraft(TODAY), templateById('wgu-term'), { newKey: keys(), today: TODAY })
    const c = d.courses[0]!
    const cut = withoutUnitKeys(d, [c.units[0]!.key, c.units[1]!.key])
    expect(draftEffort(cut).courses[0]?.totalMinutes).toBe(2400 - 800)
    const gone = withoutUnitKeys(d, c.units.map((u) => u.key))
    expect(gone.courses).toHaveLength(6)
    expect(withoutUnitKeys(d, [c.key]).courses).toHaveLength(6)
  })
})

describe('persistence', () => {
  it('round-trips a draft, and drops damaged or foreign text', () => {
    const d = applyTemplate(emptyPlannerDraft(TODAY), templateById('certification'), { newKey: keys(), today: TODAY })
    const state: PlannerState = { draft: d, step: 4, reached: 5, attempted: true }
    const back = restorePlanner(serializePlanner(state), TODAY)
    expect(back?.draft).toEqual(d)
    expect(back).toMatchObject({ step: 4, reached: 5, attempted: false })
    expect(restorePlanner(null, TODAY)).toBeNull()
    expect(restorePlanner('{nope', TODAY)).toBeNull()
    expect(restorePlanner(JSON.stringify({ draft: { v: 2 }, step: 0, reached: 0 }), TODAY)).toBeNull()
  })

  it('moves an old start date to today', () => {
    const d = { ...emptyPlannerDraft('2026-08-01'), startDate: '2026-08-01' as const }
    const back = restorePlanner(serializePlanner({ draft: d, step: 0, reached: 0, attempted: false }), TODAY)
    expect(back?.draft.startDate).toBe(TODAY)
  })
})

describe('reading text', () => {
  it('reads pasted text and remembers what it read', async () => {
    const { readSourceText } = await import('./plannerDraft')
    const d = readSourceText(emptyPlannerDraft(TODAY), WGU_LIST, { source: 'paste', newKey: keys(), today: TODAY })
    expect(d.courses).toHaveLength(3)
    expect(d.readText).toBe(WGU_LIST)
    expect(d.source).toBe('paste')
  })

  it('reads a typed goal as one course to break down', async () => {
    const { readTypedGoal } = await import('./plannerDraft')
    const d = readTypedGoal(
      { ...emptyPlannerDraft(TODAY), title: 'Learn conversational Spanish by June 2027', description: '30 minutes a day' },
      { newKey: keys(), today: TODAY },
    )
    expect(d.needsBreakdown).toBe(true)
    expect(d.courses).toHaveLength(1)
    expect(d.targetDate).toBe('2027-06-30')
    expect(d.description).toBe('30 minutes a day')
    expect(d.source).toBe('typed')
  })
})
