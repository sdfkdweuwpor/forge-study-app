import { describe, expect, it } from 'vitest'
import {
  draftFromGoal,
  draftSchedule,
  draftToRows,
  emptyCourse,
  emptyDraft,
  firstInvalidStep,
  moveCourse,
  moveItem,
  parseCus,
  parseHours,
  parseUnits,
  previewPlan,
  prerequisiteOptions,
  pruneStalePrerequisites,
  removeCourse,
  reorderCourses,
  setDayMinutes,
  setTermEnd,
  setTermStart,
  termEndFor,
  validateAvailability,
  validateBasics,
  validateSchedule,
  validateCourses,
  validateStep,
  weekSummary,
  type DraftCourse,
  type DraftGoal,
} from './goalDraft'
import { wguTemplate, WGU_TEMPLATE_COURSES } from './goalTemplates'

const TODAY = '2026-09-29'

function keys(): () => string {
  let n = 0
  return () => `k${++n}`
}

function course(key: string, extra: Partial<DraftCourse> = {}): DraftCourse {
  return {
    key,
    code: key.toUpperCase(),
    title: `Course ${key}`,
    hours: '20',
    cus: '3',
    courseType: 'OA',
    prerequisiteKeys: [],
    units: '',
    ...extra,
  }
}

function ids(): () => string {
  let n = 0
  return () => `id${++n}`
}

describe('termEndFor', () => {
  it('is six months later minus a day', () => {
    expect(termEndFor('2026-10-01')).toBe('2027-03-31')
    expect(termEndFor('2026-09-29')).toBe('2027-03-28')
    // Month-end clamping: 31 Aug + 6 months = 28 Feb, minus a day.
    expect(termEndFor('2026-08-31')).toBe('2027-02-27')
  })

  it('follows the start until the end is set by hand', () => {
    const term = emptyDraft(TODAY).term
    const moved = setTermStart(term, '2026-11-01')
    expect(moved.end).toBe('2027-04-30')
    const edited = setTermEnd(moved, '2027-03-01')
    expect(setTermStart(edited, '2026-12-01').end).toBe('2027-03-01')
  })
})

describe('parsing', () => {
  it('reads hours', () => {
    expect(parseHours('40')).toBe(40)
    expect(parseHours(' 12.5 ')).toBe(12.5)
    expect(parseHours('12,5')).toBe(12.5)
    expect(parseHours('')).toBeNull()
    expect(parseHours('0')).toBeNull()
    expect(parseHours('-3')).toBeNull()
    expect(parseHours('abc')).toBeNull()
    expect(parseHours('2001')).toBeNull()
  })

  it('reads CUs, where empty is fine', () => {
    expect(parseCus('')).toEqual({ ok: true, value: null })
    expect(parseCus(' 4 ')).toEqual({ ok: true, value: 4 })
    expect(parseCus('0')).toEqual({ ok: true, value: 0 })
    expect(parseCus('4.5')).toEqual({ ok: false })
    expect(parseCus('41')).toEqual({ ok: false })
  })

  it('splits units by line and ignores blanks', () => {
    expect(parseUnits('  HTML   basics \n\n CSS\n   \nJS')).toEqual(['HTML basics', 'CSS', 'JS'])
    expect(parseUnits('')).toEqual([])
  })
})

describe('editing', () => {
  it('moves items', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 0, 99)).toEqual(['b', 'a'])
  })

  it('drops prerequisites that no longer point at an earlier course', () => {
    const list = [
      course('a'),
      course('b', { prerequisiteKeys: ['a'] }),
      course('c', { prerequisiteKeys: ['a', 'b'] }),
    ]
    // Nothing stale: the same rows come back.
    expect(pruneStalePrerequisites(list)).toEqual(list)
    // Moving `a` below `b` leaves `b` requiring a later course.
    const moved = moveCourse(list, 0, 1)
    expect(moved.map((c) => c.key)).toEqual(['b', 'a', 'c'])
    expect(moved[0]?.prerequisiteKeys).toEqual([])
    expect(moved[2]?.prerequisiteKeys).toEqual(['a', 'b'])
  })

  it('reorders by key list, keeping unlisted courses at the end', () => {
    const list = [course('a'), course('b', { prerequisiteKeys: ['a'] }), course('c')]
    const next = reorderCourses(list, ['c', 'b', 'zzz'])
    expect(next.map((c) => c.key)).toEqual(['c', 'b', 'a'])
    // b required a, which is now later.
    expect(next[1]?.prerequisiteKeys).toEqual([])
  })

  it('removing a course removes it from the prerequisites of the others', () => {
    const list = [
      course('a'),
      course('b', { prerequisiteKeys: ['a'] }),
      course('c', { prerequisiteKeys: ['a', 'b'] }),
    ]
    const next = removeCourse(list, 'a')
    expect(next.map((c) => c.key)).toEqual(['b', 'c'])
    expect(next[0]?.prerequisiteKeys).toEqual([])
    expect(next[1]?.prerequisiteKeys).toEqual(['b'])
  })

  it('offers only earlier courses as prerequisites', () => {
    const list = [course('a'), course('b'), course('c')]
    expect(prerequisiteOptions(list, 'a')).toEqual([])
    expect(prerequisiteOptions(list, 'c').map((c) => c.key)).toEqual(['a', 'b'])
    expect(prerequisiteOptions(list, 'nope')).toEqual([])
  })

  it('sets a weekday, clamped, and summarises the week', () => {
    const week = emptyDraft(TODAY).minutesByWeekday
    expect(weekSummary(week)).toEqual({ days: 5, minutes: 300 })
    const sat = setDayMinutes(week, 6, 90.4)
    expect(sat[6]).toBe(90)
    expect(week[6]).toBe(0)
    expect(setDayMinutes(week, 1, -5)[1]).toBe(0)
    expect(setDayMinutes(week, 1, 99999)[1]).toBe(960)
    expect(weekSummary(sat)).toEqual({ days: 6, minutes: 390 })
  })
})

describe('validation', () => {
  const valid = (): DraftGoal => ({
    ...emptyDraft(TODAY),
    title: 'B.S. Computer Science',
    courses: [course('a'), course('b')],
  })

  it('needs a title, and a future target', () => {
    expect(validateBasics(valid(), TODAY)).toEqual({})
    expect(validateBasics({ ...valid(), title: '  ' }, TODAY)).toHaveProperty('title')
    expect(validateBasics({ ...valid(), title: 'x'.repeat(121) }, TODAY)).toHaveProperty('title')
    expect(validateBasics({ ...valid(), targetDate: TODAY }, TODAY)).toHaveProperty('targetDate')
    expect(validateBasics({ ...valid(), targetDate: '2026-09-01' }, TODAY)).toHaveProperty(
      'targetDate',
    )
    expect(validateBasics({ ...valid(), targetDate: '2027-03-28' }, TODAY)).toEqual({})
  })

  it('checks every course', () => {
    expect(validateCourses(valid())).toEqual({})
    expect(validateCourses({ ...valid(), courses: [] })).toHaveProperty('courses')
    const errors = validateCourses({
      ...valid(),
      courses: [course('a', { title: '', hours: '', cus: 'x' }), course('b')],
    })
    expect(Object.keys(errors).sort()).toEqual(['course:a:cus', 'course:a:hours', 'course:a:title'])
  })

  it('needs a study day, complete ranges and a sane term', () => {
    expect(validateAvailability(valid())).toEqual({})
    expect(
      validateAvailability({ ...valid(), minutesByWeekday: [0, 0, 0, 0, 0, 0, 0] }),
    ).toHaveProperty('days')
    const errors = validateAvailability({
      ...valid(),
      daysOff: [
        { key: 'r1', start: '', end: '', label: '' },
        { key: 'r2', start: '2026-12-24', end: '2026-12-20', label: '' },
        { key: 'r3', start: '2026-12-20', end: '2026-12-24', label: 'Holidays' },
      ],
      term: {
        enabled: true,
        label: 'Term 1',
        start: '2026-10-01',
        end: '2026-09-01',
        endEdited: true,
      },
    })
    expect(Object.keys(errors).sort()).toEqual(['range:r1', 'range:r2', 'term'])
    // A disabled term is not checked.
    expect(
      validateAvailability({
        ...valid(),
        term: { enabled: false, label: '', start: '', end: '', endEdited: false },
      }),
    ).toEqual({})
  })

  it('checks the schedule settings: target date and availability, but not the name', () => {
    const base = { ...emptyDraft(TODAY), title: '' }
    expect(validateSchedule(base, TODAY)).toEqual({})
    expect(Object.keys(validateSchedule({ ...base, targetDate: '2026-01-01' }, TODAY))).toEqual([
      'targetDate',
    ])
    expect(
      Object.keys(validateSchedule({ ...base, minutesByWeekday: [0, 0, 0, 0, 0, 0, 0] }, TODAY)),
    ).toEqual(['days'])
  })

  it('walks the steps', () => {
    expect(validateStep(valid(), 0, TODAY)).toEqual({})
    expect(validateStep(valid(), 3, TODAY)).toEqual({})
    expect(firstInvalidStep(valid(), TODAY)).toBeNull()
    expect(firstInvalidStep({ ...valid(), courses: [] }, TODAY)).toBe(1)
    expect(firstInvalidStep({ ...valid(), title: '', courses: [] }, TODAY)).toBe(0)
    expect(firstInvalidStep({ ...valid(), minutesByWeekday: [0, 0, 0, 0, 0, 0, 0] }, TODAY)).toBe(2)
  })
})

describe('draftToRows', () => {
  it('builds the goal, courses and units', () => {
    const draft: DraftGoal = {
      ...emptyDraft(TODAY),
      title: '  B.S.   Computer Science ',
      icon: '🎓',
      coverPreset: 'sand',
      kind: 'degree',
      targetDate: '2027-03-28',
      courses: [
        course('a', {
          code: ' C182 ',
          title: 'Introduction to IT',
          hours: '40',
          cus: '4',
          units: 'Hardware\n\nNetworks',
        }),
        course('b', {
          code: '',
          title: 'Web Development Foundations',
          hours: '12,5',
          cus: '',
          courseType: '',
          prerequisiteKeys: ['a', 'zzz'],
        }),
      ],
      minutesByWeekday: [0, 90, 90, 90, 90, 90, 120],
      daysOff: [
        { key: 'r2', start: '2026-12-24', end: '2026-12-26', label: '' },
        { key: 'r1', start: '2026-11-25', end: '2026-11-29', label: ' Thanksgiving ' },
        { key: 'r3', start: '', end: '', label: '' },
      ],
      term: { enabled: true, label: ' Term 1 ', start: TODAY, end: '2027-03-28', endEdited: false },
    }
    const { goal, milestones, units } = draftToRows(draft, {
      today: TODAY,
      now: 1_000,
      newId: ids(),
      goalOrder: 7,
    })

    expect(goal).toMatchObject({
      id: 'id1',
      title: 'B.S. Computer Science',
      icon: '🎓',
      cover: { kind: 'gradient', preset: 'sand' },
      kind: 'degree',
      status: 'active',
      startDate: TODAY,
      targetDate: '2027-03-28',
      order: 7,
      baselineEnd: null,
      projection: null,
      createdAt: 1_000,
      terms: [{ id: 'id2', label: 'Term 1', start: TODAY, end: '2027-03-28' }],
      availability: {
        minutesByWeekday: [0, 90, 90, 90, 90, 90, 120],
        daysOff: [
          { start: '2026-11-25', end: '2026-11-29', label: 'Thanksgiving' },
          { start: '2026-12-24', end: '2026-12-26' },
        ],
      },
    })

    expect(milestones).toHaveLength(2)
    expect(milestones[0]).toMatchObject({
      id: 'id3',
      goalId: 'id1',
      kind: 'course',
      code: 'C182',
      title: 'Introduction to IT',
      estimateHours: 40,
      cus: 4,
      courseType: 'OA',
      status: 'todo',
      order: 0,
      termId: 'id2',
      prerequisiteIds: [],
    })
    expect(milestones[1]).toMatchObject({
      code: null,
      estimateHours: 12.5,
      cus: null,
      courseType: null,
      order: 1,
      // The unknown key is ignored, the known one is mapped to the id.
      prerequisiteIds: ['id3'],
    })
    expect(units.map((u) => [u.milestoneId, u.title, u.order, u.estimateMinutes])).toEqual([
      ['id3', 'Hardware', 0, null],
      ['id3', 'Networks', 1, null],
    ])
  })

  it('does not copy the draft’s arrays and skips a disabled term', () => {
    const draft = { ...emptyDraft(TODAY), title: 'x', courses: [course('a')] }
    const { goal } = draftToRows(draft, { today: TODAY, now: 0, newId: ids() })
    expect(goal.terms).toEqual([])
    expect(goal.cover).toBeNull()
    expect(goal.availability.minutesByWeekday).not.toBe(draft.minutesByWeekday)
    expect(
      draftToRows(draft, { today: TODAY, now: 0, newId: ids() }).milestones[0]?.termId,
    ).toBeNull()
  })
})

describe('previewPlan', () => {
  it('projects a finish date from draft rows with no tasks', () => {
    const draft: DraftGoal = {
      ...emptyDraft(TODAY),
      title: 'Small goal',
      // 10 h of work in one-hour windows Mon–Fri, one 50-min session a day: twelve study days from
      // Tue 29 Sep (the last on Wed 14 Oct).
      courses: [course('a', { hours: '10' })],
    }
    const plan = previewPlan(draft, TODAY)
    expect(plan.result.totals.study).toBe(600)
    expect(plan.result.projectedEnd).toBe('2026-10-14')
    expect(plan.projection.feasible).toBe(true)
    expect(plan.diff.insert.length).toBeGreaterThan(0)
    // Slots start at the study start (09:00 by default) on each study day.
    expect(plan.diff.insert[0]).toMatchObject({ doDate: TODAY, doTime: '09:00', kind: 'study' })
  })

  it('warns when the target is out of reach, and says what would work', () => {
    const draft: DraftGoal = {
      ...emptyDraft(TODAY),
      title: 'Tight goal',
      targetDate: '2026-10-09',
      courses: [course('a', { hours: '30' })],
    }
    const plan = previewPlan(draft, TODAY)
    expect(plan.projection.feasible).toBe(false)
    expect(plan.projection.slipDays).toBeGreaterThan(0)
    expect(plan.catchUp?.requiredMinutesPerStudyDay ?? 0).toBeGreaterThan(60)
  })

  it('has no end when there are no study days', () => {
    const draft: DraftGoal = {
      ...emptyDraft(TODAY),
      title: 'x',
      minutesByWeekday: [0, 0, 0, 0, 0, 0, 0],
      courses: [course('a')],
    }
    const plan = previewPlan(draft, TODAY)
    expect(plan.result.projectedEnd).toBeNull()
    expect(plan.projection.issues).toContain('NO_AVAILABILITY')
  })
})

describe('emptyCourse and the WGU template', () => {
  it('starts a blank course', () => {
    expect(emptyCourse(keys())).toEqual({
      key: 'k1',
      code: '',
      title: '',
      hours: '',
      cus: '',
      courseType: '',
      prerequisiteKeys: [],
      units: '',
    })
  })

  it('is a complete, valid B.S. Computer Science draft', () => {
    const draft = wguTemplate(TODAY, keys())
    expect(draft.courses.map((c) => c.code)).toEqual([
      'C182',
      'C779',
      'D278',
      'C172',
      'C959',
      'D426',
      'C867',
    ])
    expect(draft.courses.map((c) => Number(c.cus)).reduce((a, b) => a + b, 0)).toBe(24)
    expect(firstInvalidStep(draft, TODAY)).toBeNull()
    expect(draft.term).toMatchObject({ enabled: true, start: TODAY, end: '2027-03-28' })
    expect(draft.targetDate).toBe('2027-03-28')
    // C867 needs D278 first.
    const d278 = draft.courses.find((c) => c.code === 'D278')
    const c867 = draft.courses.find((c) => c.code === 'C867')
    expect(c867?.prerequisiteKeys).toEqual([d278?.key])
    expect(WGU_TEMPLATE_COURSES).toHaveLength(7)
  })

  it('fits in its own six-month term', () => {
    const draft = wguTemplate(TODAY, keys())
    const plan = previewPlan(draft, TODAY)
    expect(plan.projection.feasible).toBe(true)
    expect(plan.result.projectedEnd && plan.result.projectedEnd <= '2027-03-28').toBe(true)
    // Every unit of every course becomes work, in order, with C867 after D278.
    const windows = new Map(plan.result.courseWindows.map((w) => [w.courseId, w]))
    expect(windows.size).toBe(7)
    const idOf = (code: string): string => plan.input.courses.find((c) => c.code === code)?.id ?? ''
    expect(
      (windows.get(idOf('C867'))?.start ?? '') >= (windows.get(idOf('D278'))?.end ?? '~'),
    ).toBe(true)
  })
})

describe('draftSchedule and draftFromGoal', () => {
  it('turns the schedule part of a draft into stored values, keeping the term id', () => {
    const draft: DraftGoal = {
      ...emptyDraft(TODAY),
      targetDate: '2027-03-28',
      minutesByWeekday: [0, 90, 90, 90, 90, 90, 120],
      daysOff: [
        { key: 'r1', start: '2026-12-24', end: '2026-12-26', label: '' },
        { key: 'r2', start: '', end: '', label: '' },
      ],
      term: { enabled: true, label: ' Term 1 ', start: TODAY, end: '2027-03-28', endEdited: false },
    }
    expect(draftSchedule(draft, 'term-1')).toEqual({
      targetDate: '2027-03-28',
      availability: {
        minutesByWeekday: [0, 90, 90, 90, 90, 90, 120],
        daysOff: [{ start: '2026-12-24', end: '2026-12-26' }],
      },
      terms: [{ id: 'term-1', label: 'Term 1', start: TODAY, end: '2027-03-28' }],
    })
    expect(draftSchedule({ ...draft, term: { ...draft.term, enabled: false } }, 'x').terms).toEqual(
      [],
    )
  })

  it('round-trips a goal’s schedule through a draft', () => {
    const goal = {
      title: 'B.S. Computer Science',
      icon: '🎓',
      kind: 'degree' as const,
      targetDate: '2027-03-28',
      availability: {
        minutesByWeekday: [0, 60, 60, 60, 60, 60, 120] as [
          number,
          number,
          number,
          number,
          number,
          number,
          number,
        ],
        daysOff: [{ start: '2026-11-25', end: '2026-11-29', label: 'Thanksgiving' }],
      },
      terms: [{ id: 't1', label: 'Term 1', start: TODAY, end: '2027-03-28' }],
    }
    const draft = draftFromGoal(goal, TODAY, keys())
    expect(draft.daysOff).toEqual([
      { key: 'k1', start: '2026-11-25', end: '2026-11-29', label: 'Thanksgiving' },
    ])
    expect(draft.term).toMatchObject({ enabled: true, endEdited: true, end: '2027-03-28' })
    const back = draftSchedule(draft, 't1')
    expect(back.availability).toEqual(goal.availability)
    expect(back.terms).toEqual(goal.terms)
    expect(back.targetDate).toBe('2027-03-28')
    // No term: the draft's term is off.
    expect(draftFromGoal({ ...goal, terms: [] }, TODAY, keys()).term.enabled).toBe(false)
  })
})
