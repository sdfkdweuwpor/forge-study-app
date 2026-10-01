import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { parsePlanText } from './planParse'
import { checkFeasibility } from './scheduler'
import { templateById } from './goalTemplates'
import {
  applyParse,
  applyPlanDraft,
  applyTemplate,
  assessmentsBeforeStart,
  courseRemovalUndo,
  coursesWithoutEffort,
  draftEffort,
  emptyPlannerDraft,
  fillBlankUnits,
  firstInvalidStep,
  hasReviewEdits,
  initialPlannerState,
  plannerReducer,
  plannerRows,
  planStats,
  prerequisiteLossesByOrder,
  previewPlanner,
  readSourceText,
  shiftTemplateDates,
  sourceChanged,
  templateShiftDays,
  unitRemovalUndo,
  validatePlannerStep,
  withAddedTime,
  withoutUnitKeys,
  withTargetDate,
  type PlannerDraft,
  type PlannerState,
} from './plannerDraft'
import { serializePlanner, restorePlanner } from './plannerPersist'

const TODAY = '2026-09-29'
const shiftDate = (d: string, days: number) => addDays(d, days)
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
    expect(d.courses.map((c) => c.assessments.map((a) => a.kind))).toEqual([
      ['exam'],
      ['project'],
      ['exam'],
    ])
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
    const d = applyTemplate(emptyPlannerDraft(TODAY), templateById('wgu-term'), {
      newKey: keys(),
      today: TODAY,
    })
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
    draft: applyTemplate(emptyPlannerDraft(TODAY), templateById('wgu-term'), {
      newKey: keys(),
      today: TODAY,
    }),
  })

  it('edits, reorders and deletes courses and units', () => {
    let s = base()
    const [a, b] = s.draft.courses
    s = run(s, { type: 'reorderCourses', keys: [b?.key ?? '', a?.key ?? ''] })
    expect(s.draft.courses.slice(0, 2).map((c) => c.code)).toEqual(['C779', 'C182'])
    const first = s.draft.courses[0]
    s = run(s, {
      type: 'patchUnit',
      courseKey: first?.key ?? '',
      key: first?.units[0]?.key ?? '',
      patch: { title: 'HTML basics', minutes: 180 },
    })
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
    s = run(s, {
      type: 'unparsedToUnit',
      line: d.unparsed[0]?.line ?? 0,
      courseKey: null,
      courseKeyNew: 'nc',
      unitKey: 'nu',
    })
    expect(s.draft.unparsed).toEqual([])
    expect(s.draft.courses[0]?.units.map((u) => u.title)).toEqual(['???? Cloud storage notes'])
    const bare: PlannerState = {
      ...initialPlannerState(TODAY),
      draft: {
        ...emptyPlannerDraft(TODAY),
        title: 'Read',
        unparsed: [{ line: 1, text: 'Chapter one' }],
      },
    }
    const next = run(bare, {
      type: 'unparsedToUnit',
      line: 1,
      courseKey: null,
      courseKeyNew: 'nc',
      unitKey: 'nu',
    })
    expect(next.draft.courses[0]?.units[0]?.title).toBe('Chapter one')
  })

  it('setting a course rating changes the units that follow it and keeps the ones rated on their own', () => {
    let s = base()
    const c = s.draft.courses[0]
    const [own, following] = c?.units ?? []
    s = run(s, {
      type: 'patchUnit',
      courseKey: c?.key ?? '',
      key: own?.key ?? '',
      patch: { rating: 'know' },
    })
    const before = draftEffort(s.draft).courses[0]?.units
    s = run(s, { type: 'setCourseRating', courseKey: c?.key ?? '', rating: 'somewhat' })
    const course = s.draft.courses[0]
    expect(course?.rating).toBe('somewhat')
    // The unit rated 'know' by hand keeps it; the others still follow the course.
    expect(course?.units[0]?.rating).toBe('know')
    expect(course?.units.slice(1).every((u) => u.rating === null)).toBe(true)
    const after = draftEffort(s.draft).courses[0]?.units
    expect(after?.[0]?.minutes).toBe(before?.[0]?.minutes)
    expect(after?.[1]?.minutes).toBeLessThan(before?.[1]?.minutes ?? 0)
    expect(following?.key).toBe(course?.units[1]?.key)
  })

  it('Undo of a unit delete brings back exactly that unit and leaves edits to its siblings', () => {
    let s = base()
    const c = s.draft.courses[0]
    const [first, second, third] = c?.units ?? []
    const undo = unitRemovalUndo(s.draft, c?.key ?? '', second?.key ?? '')
    expect(undo?.index).toBe(1)
    s = run(s, { type: 'removeUnit', courseKey: c?.key ?? '', key: second?.key ?? '' })
    expect(draftEffort(s.draft).courses[0]?.totalMinutes).toBe(2000)
    // An edit to a sibling after the delete...
    s = run(s, {
      type: 'patchUnit',
      courseKey: c?.key ?? '',
      key: third?.key ?? '',
      patch: { title: 'Renamed later', minutes: 90 },
    })
    s = run(s, {
      type: 'insertUnit',
      courseKey: c?.key ?? '',
      index: undo?.index ?? 0,
      unit: undo?.unit ?? second!,
      ...(undo ? { thaw: undo.thaw } : {}),
    })
    const units = s.draft.courses[0]?.units ?? []
    expect(units.map((u) => u.key).slice(0, 3)).toEqual([first?.key, second?.key, third?.key])
    // ...is kept, and the untouched siblings share the budget again as they did.
    expect(units[2]).toMatchObject({ title: 'Renamed later', minutes: 90 })
    expect(units[0]?.minutes).toBeNull()
    expect(units[1]).toEqual(second)
    // Undoing twice does not duplicate it.
    const again = run(s, {
      type: 'insertUnit',
      courseKey: c?.key ?? '',
      index: 1,
      unit: second!,
    })
    expect(again.draft.courses[0]?.units).toHaveLength(units.length)
  })

  it('Undo of an assessment delete restores it in place', () => {
    let s = base()
    const c = s.draft.courses[0]
    const a = c?.assessments[0]
    expect(a).toBeDefined()
    s = run(s, { type: 'removeAssessment', courseKey: c?.key ?? '', key: a?.key ?? '' })
    expect(s.draft.courses[0]?.assessments).toHaveLength((c?.assessments.length ?? 1) - 1)
    s = run(s, { type: 'insertAssessment', courseKey: c?.key ?? '', index: 0, assessment: a! })
    expect(s.draft.courses[0]?.assessments[0]).toEqual(a)
  })

  it('Undo of a course delete also brings back the requirements pruned from other courses', () => {
    let s = base()
    const initialKeys = s.draft.courses.map((c) => c.key)
    // In the WGU template the 7th course requires the 3rd.
    const [, , third, , , , seventh] = s.draft.courses
    expect(seventh?.prerequisiteKeys).toEqual([third?.key])
    const undo = courseRemovalUndo(s.draft.courses, third?.key ?? '')
    expect(undo).toMatchObject({ index: 2, dependents: [seventh?.key] })
    s = run(s, { type: 'removeCourse', key: third?.key ?? '' })
    expect(s.draft.courses).toHaveLength(6)
    expect(s.draft.courses[5]?.prerequisiteKeys).toEqual([])
    s = run(s, {
      type: 'insertCourse',
      index: undo?.index ?? 0,
      course: undo?.course ?? third!,
      dependents: undo?.dependents ?? [],
    })
    expect(s.draft.courses.map((c) => c.key)).toEqual(initialKeys)
    expect(s.draft.courses[2]?.key).toBe(third?.key)
    expect(s.draft.courses[6]?.prerequisiteKeys).toEqual([third?.key])
  })

  it('a reorder that would drop a requirement says so, and Undo puts the order and the links back', () => {
    let s = base()
    const keysBefore = s.draft.courses.map((c) => c.key)
    const [, , third, , , , seventh] = s.draft.courses
    // Move the 7th course above the 3rd, which it requires.
    const moved = [
      ...keysBefore.filter((k) => k !== seventh?.key).slice(0, 2),
      seventh?.key ?? '',
      ...keysBefore.filter((k) => k !== seventh?.key).slice(2),
    ]
    const losses = prerequisiteLossesByOrder(s.draft.courses, moved)
    expect(losses).toEqual([{ courseKey: seventh?.key, before: [third?.key], lost: [third?.key] }])
    expect(prerequisiteLossesByOrder(s.draft.courses, keysBefore)).toEqual([])
    s = run(s, { type: 'reorderCourses', keys: moved })
    expect(s.draft.courses.map((c) => c.key)).toEqual(moved)
    expect(s.draft.courses[2]?.prerequisiteKeys).toEqual([])
    s = run(s, {
      type: 'reorderCourses',
      keys: keysBefore,
      prerequisites: { [seventh?.key ?? '']: [third?.key ?? ''] },
    })
    expect(s.draft.courses.map((c) => c.key)).toEqual(keysBefore)
    expect(s.draft.courses[6]?.prerequisiteKeys).toEqual([third?.key])
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
    expect(validatePlannerStep({ ...c, targetMode: 'asap', targetDate: null }, 1, TODAY)).toEqual(
      {},
    )
    expect(validatePlannerStep({ ...c, startDate: '2026-01-01' }, 1, TODAY).startDate).toBeTruthy()
    expect(validatePlannerStep({ ...c, targetDate: TODAY }, 1, TODAY).targetDate).toBeTruthy()
    expect(validatePlannerStep({ ...c, title: ' ' }, 4, TODAY).title).toBeTruthy()
  })
})

describe('rows and preview', () => {
  const tpl = () =>
    applyTemplate(emptyPlannerDraft(TODAY), templateById('wgu-term'), {
      newKey: keys(),
      today: TODAY,
    })

  it('saves a goal with planning, courses, units, planned assessments and a term', () => {
    let n = 0
    const rows = plannerRows(tpl(), { today: TODAY, now: 1, newId: () => `id${++n}` })
    expect(rows.goal.planning).toMatchObject({
      sessionMinutes: 50,
      bufferPct: 0.12,
      cuHoursMultiplier: 15,
      asap: false,
    })
    expect(rows.goal.planning.weekly[1]).toEqual([{ start: '18:00', end: '21:00' }])
    expect(rows.goal.availability.minutesByWeekday[1]).toBe(180)
    expect(rows.goal.targetDate).toBe('2027-03-28')
    expect(rows.goal.terms).toHaveLength(1)
    expect(rows.milestones).toHaveLength(7)
    expect(rows.milestones.every((m) => m.termId === rows.goal.terms[0]?.id)).toBe(true)
    expect(rows.units).toHaveLength(37)
    expect(rows.plannedAssessments).toHaveLength(7)
    expect(
      rows.plannedAssessments.every((a) => rows.milestones.some((m) => m.id === a.milestoneId)),
    ).toBe(true)
    expect(rows.milestones[6]?.prerequisiteIds).toEqual([rows.milestones[2]?.id])
    // 310 h of study in all, from the units.
    expect(rows.units.reduce((s, u) => s + (u.estimateMinutes ?? 0), 0)).toBe(310 * 60)
    expect(
      new Set([rows.goal.id, ...rows.milestones.map((m) => m.id), ...rows.units.map((u) => u.id)])
        .size,
    ).toBe(45)
  })

  it('carries the self-rating into the unit estimate', () => {
    const d = tpl()
    const rated = {
      ...d,
      courses: d.courses.map((c, i) => (i === 0 ? { ...c, rating: 'know' as const } : c)),
    }
    const rows = plannerRows(rated, { today: TODAY, now: 1, newId: () => 'x', useKeys: true })
    const c182Units = rows.units.filter((u) => u.milestoneId === rated.courses[0]?.key)
    expect(c182Units.reduce((s, u) => s + (u.estimateMinutes ?? 0), 0)).toBe(1200)
    expect(c182Units[0]).toMatchObject({
      selfRating: 'know',
      baseEstimateMinutes: 400,
      estimateSource: 'course',
    })
  })

  it('a course without units becomes one block of its hours', () => {
    const d = parsed('C182 Introduction to IT – 40 hours')
    const rows = plannerRows(
      { ...d, targetDate: '2027-01-31' },
      { today: TODAY, now: 1, newId: () => 'x', useKeys: true },
    )
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
    const rows = plannerRows(
      { ...tpl(), targetMode: 'asap' },
      { today: TODAY, now: 1, newId: () => 'x', useKeys: true },
    )
    expect(rows.goal.targetDate).toBeNull()
    expect(rows.goal.planning.asap).toBe(true)
    expect(rows.goal.terms).toEqual([])
  })
})

describe('when it does not fit', () => {
  // Three WGU courses in two months on evenings only: too tight.
  function tight(): PlannerDraft {
    const d = applyTemplate(emptyPlannerDraft(TODAY), templateById('wgu-term'), {
      newKey: keys(),
      today: TODAY,
    })
    return {
      ...d,
      courses: d.courses
        .slice(0, 4)
        .map((c, i) =>
          i === 3 ? { ...c, units: c.units.map((u) => ({ ...u, optional: true })) } : c,
        ),
      targetDate: '2026-11-30',
      availability: {
        ...d.availability,
        weekly: d.availability.weekly.map((_ws, day) =>
          day >= 1 && day <= 5 ? [{ start: '19:00' as const, end: '20:30' as const }] : [],
        ),
      },
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
      expect(
        previewPlanner(withAddedTime(d, addTime.extraMinutesPerStudyDay), TODAY).result.fits,
      ).toBe(true)
    }
    expect(moveDate.earliestFeasibleDate).not.toBeNull()
    expect(
      previewPlanner(withTargetDate(d, moveDate.earliestFeasibleDate as string), TODAY).result.fits,
    ).toBe(true)
    if (cutScope.suggestedCut.length > 0) {
      expect(previewPlanner(withoutUnitKeys(d, cutScope.suggestedCut), TODAY).result.fits).toBe(
        true,
      )
    }
    expect(cutScope.candidates.filter((c) => c.reason === 'optional').length).toBeGreaterThan(0)
  })

  it('cutting units removes their hours, and a course with no units left', () => {
    const d = applyTemplate(emptyPlannerDraft(TODAY), templateById('wgu-term'), {
      newKey: keys(),
      today: TODAY,
    })
    const c = d.courses[0]!
    const cut = withoutUnitKeys(d, [c.units[0]!.key, c.units[1]!.key])
    expect(draftEffort(cut).courses[0]?.totalMinutes).toBe(2400 - 800)
    const gone = withoutUnitKeys(
      d,
      c.units.map((u) => u.key),
    )
    expect(gone.courses).toHaveLength(6)
    expect(withoutUnitKeys(d, [c.key]).courses).toHaveLength(6)
  })
})

describe('reading the text again', () => {
  const read = (text = WGU_LIST): PlannerDraft =>
    readSourceText(emptyPlannerDraft(TODAY), text, {
      source: 'paste',
      newKey: keys(),
      today: TODAY,
    })

  it('only counts a real edit of the text as a change', () => {
    const d = read()
    expect(sourceChanged(d)).toBe(false)
    expect(sourceChanged({ ...d, sourceText: `${d.sourceText}\n\n  ` })).toBe(false)
    expect(sourceChanged({ ...d, sourceText: d.sourceText.replace(/\n/g, '\r\n') })).toBe(false)
    expect(sourceChanged({ ...d, sourceText: `${d.sourceText}D999 Extra – 3 CUs` })).toBe(true)
    // An emptied box is not a request to read nothing, and a typed goal has no text to reread.
    expect(sourceChanged({ ...d, sourceText: '   ' })).toBe(false)
    expect(sourceChanged({ ...d, source: 'typed', sourceText: 'other' })).toBe(false)
  })

  it('knows when the outline was edited after it was read', () => {
    const d = read()
    expect(hasReviewEdits(d, TODAY)).toBe(false)
    const [a, b, c] = d.courses
    const edit = (courses: PlannerDraft['courses']) => hasReviewEdits({ ...d, courses }, TODAY)
    expect(edit([{ ...a!, hours: 99 }, b!, c!])).toBe(true)
    expect(edit([{ ...a!, effortBy: 'hours' }, b!, c!])).toBe(true)
    expect(edit([{ ...a!, rating: 'know' }, b!, c!])).toBe(true)
    expect(edit([b!, a!, c!])).toBe(true)
    expect(edit([a!, b!])).toBe(true)
    expect(
      edit([
        {
          ...a!,
          units: [{ key: 'u', title: 'New', minutes: null, rating: null, optional: false }],
        },
        b!,
        c!,
      ]),
    ).toBe(true)
    expect(hasReviewEdits({ ...d, title: 'My degree' }, TODAY)).toBe(true)
    // The same content under fresh keys is not an edit.
    expect(hasReviewEdits(read(), TODAY)).toBe(false)
  })
})

describe('a template and the start date', () => {
  const tpl = (start = TODAY) =>
    applyTemplate(
      { ...emptyPlannerDraft(TODAY), startDate: start },
      templateById('semester-course'),
      { newKey: keys(), today: TODAY },
    )
  const dates = (d: PlannerDraft) => d.courses.flatMap((c) => c.assessments.map((a) => a.date))

  it('remembers the start its dates were worked out from', () => {
    const d = tpl()
    expect(d.templateStart).toBe(TODAY)
    expect(templateShiftDays(d)).toBe(0)
    // Pasting something else is no longer a template.
    const pasted = readSourceText(d, WGU_LIST, { source: 'paste', newKey: keys(), today: TODAY })
    expect(pasted.templateStart).toBeNull()
  })

  it('offers to shift by the days the start moved, and moves the target and every assessment date', () => {
    const d = tpl()
    expect(dates(d).filter((x) => x !== null).length).toBeGreaterThan(0)
    const moved = { ...d, startDate: '2026-10-13' }
    expect(templateShiftDays(moved)).toBe(14)
    const shifted = shiftTemplateDates(moved)
    expect(dates(shifted)).toEqual(dates(d).map((x) => (x === null ? null : shiftDate(x, 14))))
    expect(shifted.targetDate).toBe(shiftDate(d.targetDate as string, 14))
    expect(shifted.templateStart).toBe('2026-10-13')
    // The offer is gone once it is taken.
    expect(templateShiftDays(shifted)).toBe(0)
    // Nothing to shift: the draft comes back as it is.
    expect(shiftTemplateDates(d)).toBe(d)
    // A start moved earlier shifts earlier.
    expect(templateShiftDays({ ...tpl('2026-10-13'), startDate: TODAY })).toBe(-14)
  })

  it('does not touch a draft that did not come from a template', () => {
    expect(templateShiftDays({ ...parsed(), startDate: '2026-10-13' })).toBe(0)
  })

  it('blocks When while an assessment is dated before the start', () => {
    const d = tpl()
    expect(assessmentsBeforeStart(d)).toEqual([])
    expect(validatePlannerStep(d, 1, TODAY)).toEqual({})
    const moved = { ...d, startDate: '2026-12-01', targetDate: '2027-03-01' }
    const early = assessmentsBeforeStart(moved)
    expect(early.length).toBeGreaterThan(0)
    expect(early.map((e) => e.date)).toEqual([...early.map((e) => e.date)].sort())
    expect(validatePlannerStep(moved, 1, TODAY).assessmentDates).toMatch(/dated before your start/)
    // Moving the template's dates along with the start clears it.
    expect(validatePlannerStep(shiftTemplateDates(moved), 1, TODAY)).toEqual({})
  })
})

describe('persistence', () => {
  it('round-trips a draft, and drops damaged or foreign text', () => {
    const d = applyTemplate(emptyPlannerDraft(TODAY), templateById('certification'), {
      newKey: keys(),
      today: TODAY,
    })
    const state: PlannerState = { draft: d, step: 4, reached: 5, attempted: true }
    const back = restorePlanner(serializePlanner(state), TODAY)
    expect(back?.draft).toEqual(d)
    expect(back).toMatchObject({ step: 4, reached: 5, attempted: false })
    expect(restorePlanner(null, TODAY)).toBeNull()
    expect(restorePlanner('{nope', TODAY)).toBeNull()
    expect(
      restorePlanner(JSON.stringify({ draft: { v: 2 }, step: 0, reached: 0 }), TODAY),
    ).toBeNull()
  })

  it('reads a draft saved before templates remembered their start', () => {
    const d = applyTemplate(emptyPlannerDraft(TODAY), templateById('certification'), {
      newKey: keys(),
      today: TODAY,
    })
    const saved = JSON.parse(serializePlanner({ draft: d, step: 1, reached: 1, attempted: false }))
    delete saved.draft.templateStart
    const back = restorePlanner(JSON.stringify(saved), TODAY)
    expect(back?.draft.templateStart).toBeNull()
    expect(
      restorePlanner(serializePlanner({ draft: d, step: 1, reached: 1, attempted: false }), TODAY)
        ?.draft.templateStart,
    ).toBe(TODAY)
  })

  it('moves an old start date to today', () => {
    const d = { ...emptyPlannerDraft('2026-08-01'), startDate: '2026-08-01' as const }
    const back = restorePlanner(
      serializePlanner({ draft: d, step: 0, reached: 0, attempted: false }),
      TODAY,
    )
    expect(back?.draft.startDate).toBe(TODAY)
  })
})

describe('reading text', () => {
  it('reads pasted text and remembers what it read', async () => {
    const { readSourceText } = await import('./plannerDraft')
    const d = readSourceText(emptyPlannerDraft(TODAY), WGU_LIST, {
      source: 'paste',
      newKey: keys(),
      today: TODAY,
    })
    expect(d.courses).toHaveLength(3)
    expect(d.readText).toBe(WGU_LIST)
    expect(d.source).toBe('paste')
  })

  it('reads a typed goal as one course to break down', async () => {
    const { readTypedGoal } = await import('./plannerDraft')
    const d = readTypedGoal(
      {
        ...emptyPlannerDraft(TODAY),
        title: 'Learn conversational Spanish by June 2027',
        description: '30 minutes a day',
      },
      { newKey: keys(), today: TODAY },
    )
    expect(d.needsBreakdown).toBe(true)
    expect(d.courses).toHaveLength(1)
    expect(d.targetDate).toBe('2027-06-30')
    expect(d.description).toBe('30 minutes a day')
    expect(d.source).toBe('typed')
  })
})
