import { describe, expect, it } from 'vitest'
import type { Availability, ISODate, WeekMinutes } from '@/db/types'
import { addDays, eachDay, weekdayOf } from '../dates'
import {
  addMinutesToStudyDays,
  dayNumber,
  isoOfDay,
  mergeDaysOff,
  resolveOptions,
  studyDaysBetween,
  weekdayOfDay,
} from './capacity'
import { suggestCatchUp } from './catchUp'
import { computeRemaining, parseScheduleKey, resolveUnitEstimates } from './estimates'
import {
  applyDiff,
  avail,
  checkInvariants,
  completeTasks,
  course,
  goalRow,
  input,
  milestoneRow,
  MONDAY,
  taskRow,
  unit,
  unitRow,
  week,
  wguYearPlan,
} from './fixtures'
import { isDiffEmpty } from './diff'
import { planGoal } from './plan'
import { buildSchedule } from './schedule'
import { orderCourses } from './topo'
import type { PlannedChunk, ScheduleInput, ScheduleResult } from './types'

const ok = (inp: ScheduleInput): ScheduleResult => {
  const res = buildSchedule(inp)
  expect(checkInvariants(inp, res)).toEqual([])
  return res
}

const perDay = (res: ScheduleResult): Record<ISODate, number> => {
  const out: Record<ISODate, number> = {}
  for (const c of res.chunks) out[c.date] = (out[c.date] ?? 0) + c.minutes
  return out
}

const brief = (chunks: readonly PlannedChunk[]) => chunks.map((c) => [c.date, c.key, c.minutes])

const courseOrder = (res: ScheduleResult): string[] => res.windows.map((w) => w.courseId)

/** The first day after `date` with capacity that is not a day off. */
function nextStudyDay(date: ISODate, a: Availability): ISODate {
  let d = addDays(date, 1)
  while (
    a.minutesByWeekday[weekdayOf(d)] === 0 ||
    a.daysOff.some((r) => d >= r.start && d <= r.end)
  )
    d = addDays(d, 1)
  return d
}

/** Weekday minutes with every study weekday set to `r`. */
const uniform = (a: Availability, r: number): Availability => ({
  ...a,
  minutesByWeekday: a.minutesByWeekday.map((m) => (m > 0 ? r : 0)) as WeekMinutes,
})

// 2 courses, Mon–Fri 60 and Sat 120, from Monday 2026-10-05.
const twoCourses = (): ScheduleInput =>
  input({
    courses: [course('a', [120, 180], { order: 0 }), course('b', [150], { order: 1 })],
    availability: avail(week(60, 120, 0)),
  })

describe('normal schedule', () => {
  it('places two courses in order, never on Sundays, matching the hand-computed plan', () => {
    const res = ok(twoCourses())
    expect(brief(res.chunks)).toEqual([
      ['2026-10-05', 'a-u1:1', 60],
      ['2026-10-06', 'a-u1:2', 60],
      ['2026-10-07', 'a-u2:1', 60],
      ['2026-10-08', 'a-u2:2', 60],
      ['2026-10-09', 'a-u2:3', 60],
      ['2026-10-10', 'b-u1:1', 90],
      ['2026-10-10', 'b-u1:2', 30],
      ['2026-10-12', 'b-u1:3', 30],
    ])
    expect(res.chunks.some((c) => weekdayOf(c.date) === 0)).toBe(false)
    expect(res.projectedEnd).toBe('2026-10-12')
    expect(res.totalMinutes).toBe(450)
    expect(res.feasible).toBe(true)
    expect(res.issues).toEqual([])
    expect(res.windows).toEqual([
      { courseId: 'a', start: '2026-10-05', end: '2026-10-09', minutes: 300 },
      { courseId: 'b', start: '2026-10-10', end: '2026-10-12', minutes: 150 },
    ])
    expect(res.chunks[0]).toMatchObject({
      seq: 1,
      seqTotal: 2,
      title: 'A · Topic 1 (1/2)',
      orderInDay: 0,
    })
    expect(res.chunks[6]).toMatchObject({ orderInDay: 1, title: 'B · Topic 1 (2/3)' })
  })

  it('is deterministic: two runs, and shuffled input, give deep-equal output', () => {
    const inp = wguYearPlan()
    const shuffled: ScheduleInput = {
      ...inp,
      courses: [...inp.courses].reverse().map((c) => ({ ...c, units: [...c.units].reverse() })),
    }
    const a = buildSchedule(inp)
    expect(buildSchedule(inp)).toEqual(a)
    expect(buildSchedule(structuredClone(inp))).toEqual(a)
    expect(buildSchedule(shuffled)).toEqual(a)
  })

  it('slip is measured against the target, else the baseline', () => {
    expect(ok({ ...twoCourses(), targetDate: '2026-10-09' }).slipDays).toBe(3)
    expect(ok({ ...twoCourses(), baselineEnd: '2026-10-15' }).slipDays).toBe(-3)
    expect(ok(twoCourses()).slipDays).toBeNull()
  })

  it('starts at a future startDate, and ignores a past one', () => {
    const future = ok({ ...twoCourses(), startDate: '2026-10-07' })
    expect(future.chunks[0]?.date).toBe('2026-10-07')
    const past = ok({ ...twoCourses(), startDate: '2026-01-01' })
    expect(past.chunks[0]?.date).toBe(MONDAY)
  })

  it('returns nothing, feasibly, when no work remains', () => {
    const res = ok(input({ courses: [course('a', [0, 0])], targetDate: '2026-10-01' }))
    expect(res).toMatchObject({ chunks: [], projectedEnd: null, feasible: true, issues: [] })
  })
})

describe('missed day', () => {
  it('moves undone work from yesterday forward by one study day, updating tasks in place', () => {
    const monday = ok(twoCourses())
    const tuesday: ScheduleInput = { ...twoCourses(), today: '2026-10-06' }
    const res = ok(tuesday)
    expect(res.chunks.every((c) => c.date >= '2026-10-06')).toBe(true)
    expect(res.totalMinutes).toBe(monday.totalMinutes)
    expect(res.projectedEnd).toBe(nextStudyDay('2026-10-12', tuesday.availability))

    // Through planGoal: the same tasks are moved, none created or deleted.
    const rows = {
      goal: goalRow({ availability: avail(week(60, 120, 0)) }),
      milestones: [milestoneRow('a', { order: 0 }), milestoneRow('b', { order: 1 })],
      units: [
        unitRow('a-u1', 'a', 120),
        unitRow('a-u2', 'a', 180, { order: 1 }),
        unitRow('b-u1', 'b', 150),
      ],
      tasks: [],
    }
    const first = planGoal(rows, MONDAY)
    const tasks = applyDiff([], first.diff)
    const next = planGoal({ ...rows, tasks }, '2026-10-06')
    expect(next.diff.insert).toEqual([])
    expect(next.diff.remove).toEqual([])
    expect(next.diff.trash).toEqual([])
    expect(next.diff.update.length).toBeGreaterThan(0)
    expect(applyDiff(tasks, next.diff).every((t) => (t.dueDate as string) >= '2026-10-06')).toBe(
      true,
    )
    expect(
      applyDiff(tasks, next.diff)
        .map((t) => t.id)
        .sort(),
    ).toEqual(tasks.map((t) => t.id).sort())
    expect(next.result.projectedEnd).toBe('2026-10-13')
  })
})

describe('missed week', () => {
  // 40 h over Mon–Fri 60 / Sat 120, target = the original end.
  const plan = (today: ISODate, extra: Partial<ScheduleInput> = {}): ScheduleInput =>
    input({
      today,
      courses: [course('a', [600, 600], { order: 0 }), course('b', [600, 600], { order: 1 })],
      availability: avail(week(60, 120, 0)),
      ...extra,
    })

  it('slips by the week and suggests a verified catch-up', () => {
    const original = ok(plan(MONDAY))
    const target = original.projectedEnd as ISODate
    const late = plan('2026-10-12', { targetDate: target })
    const res = ok(late)
    expect(res.slipDays).toBe(7)
    expect(res.feasible).toBe(false)

    const cu = suggestCatchUp(late, res)
    const x = cu?.extraMinutesPerStudyDay
    expect(x).toBeTypeOf('number')
    const withX = (m: number) =>
      buildSchedule({ ...late, availability: addMinutesToStudyDays(late.availability, m) })
    expect(withX(x as number).feasible).toBe(true)
    expect((x as number) - 5 === 0 ? res.feasible : withX((x as number) - 5).feasible).toBe(false)
    expect(cu?.suggestedTargetDate).toBe(res.projectedEnd)
    expect(
      checkInvariants(
        { ...late, availability: addMinutesToStudyDays(late.availability, x as number) },
        withX(x as number),
      ),
    ).toEqual([])
  })

  it('uses the baseline as the reference when there is no target', () => {
    const original = ok(plan(MONDAY))
    const late = plan('2026-10-12', { baselineEnd: original.projectedEnd })
    const res = ok(late)
    expect(res.slipDays).toBe(7)
    expect(res.feasible).toBe(true)
    const cu = suggestCatchUp(late, res)
    const x = cu?.extraMinutesPerStudyDay as number
    expect(x).toBeGreaterThan(0)
    const after = buildSchedule({
      ...late,
      availability: addMinutesToStudyDays(late.availability, x),
    })
    expect(after.slipDays).toBeLessThanOrEqual(0)
    const before = buildSchedule({
      ...late,
      availability: addMinutesToStudyDays(late.availability, x - 5),
    })
    expect(before.slipDays).toBeGreaterThan(0)
  })

  it('is null when the plan is on time or has no reference date', () => {
    expect(suggestCatchUp(plan(MONDAY))).toBeNull()
    expect(suggestCatchUp(plan(MONDAY, { targetDate: '2027-12-31' }))).toBeNull()
  })
})

describe('completing early', () => {
  it('drops a course marked done at 50% and pulls the next one forward', () => {
    const base = input({
      courses: [course('a', [300, 300], { order: 0 }), course('b', [300], { order: 1 })],
    })
    const before = ok(base)
    const after = ok({
      ...base,
      courses: [
        course('a', [0, 300], { order: 0, status: 'done' }),
        course('b', [300], { order: 1 }),
      ],
    })
    expect(after.chunks.some((c) => c.courseId === 'a')).toBe(false)
    const bStart = (r: ScheduleResult) => r.windows.find((w) => w.courseId === 'b')?.start as string
    expect(bStart(after) < bStart(before)).toBe(true)
    expect(bStart(after)).toBe(MONDAY)
    expect((after.projectedEnd as string) < (before.projectedEnd as string)).toBe(true)
  })

  it('a unit marked done early frees its time (planGoal)', () => {
    const rows = {
      goal: goalRow(),
      milestones: [milestoneRow('a')],
      units: [unitRow('a1', 'a', 300), unitRow('a2', 'a', 300, { order: 1 })],
      tasks: [],
    }
    const full = planGoal(rows, MONDAY)
    const early = planGoal(
      { ...rows, units: [unitRow('a1', 'a', 300, { status: 'done' }), rows.units[1]!] },
      MONDAY,
    )
    expect(early.result.chunks.every((c) => c.unitId === 'a2')).toBe(true)
    expect((early.result.projectedEnd as string) < (full.result.projectedEnd as string)).toBe(true)
  })
})

describe('vacation days', () => {
  const base = input({ courses: [course('a', [600, 600])] }) // 20 study days of 60

  it('places nothing inside a days-off range and pushes the end by its study days', () => {
    const plain = ok(base)
    const vacation = { start: '2026-10-12', end: '2026-10-18' } // Mon–Sun: 5 study days
    const away = ok({ ...base, availability: avail(week(60), [vacation]) })
    expect(away.chunks.some((c) => c.date >= vacation.start && c.date <= vacation.end)).toBe(false)
    let expected = plain.projectedEnd as ISODate
    for (let i = 0; i < 5; i++) expected = nextStudyDay(expected, base.availability)
    expect(away.projectedEnd).toBe(expected)
    expect(studyDaysBetween(base.availability, vacation.start, vacation.end)).toBe(5)
  })

  it('merges global days off with the goal’s own', () => {
    const merged = mergeDaysOff(avail(week(60), [{ start: '2026-10-12', end: '2026-10-12' }]), [
      { start: '2026-10-13', end: '2026-10-14', label: 'Global' },
    ])
    expect(merged.daysOff).toHaveLength(2)
    const res = ok({ ...base, availability: merged })
    expect(res.chunks.some((c) => c.date >= '2026-10-12' && c.date <= '2026-10-14')).toBe(false)

    const rows = {
      goal: goalRow(),
      milestones: [milestoneRow('a')],
      units: [unitRow('a1', 'a', 600)],
      tasks: [],
      globalDaysOff: [{ start: '2026-10-06', end: '2026-10-07' }],
    }
    const plan = planGoal(rows, MONDAY)
    expect(plan.result.chunks.map((c) => c.date)).not.toContain('2026-10-06')
    expect(plan.result.chunks.map((c) => c.date)).not.toContain('2026-10-07')
  })
})

describe('impossible deadline', () => {
  const tight = input({
    courses: [course('a', [1200, 1200])], // 40 h
    availability: avail(week(60)),
    targetDate: '2026-10-16', // 10 study days
  })

  it('is not feasible and gives a verified required minutes per study day', () => {
    const res = ok(tight)
    expect(res.feasible).toBe(false)
    const cu = suggestCatchUp(tight, res)
    expect(cu?.studyDaysLeft).toBe(10)
    const r = cu?.requiredMinutesPerStudyDay as number
    expect(r).toBe(240)
    expect(buildSchedule({ ...tight, availability: uniform(tight.availability, r) }).feasible).toBe(
      true,
    )
    expect(
      buildSchedule({ ...tight, availability: uniform(tight.availability, r - 5) }).feasible,
    ).toBe(false)
    // "+X" is capped at maxCatchUp (240): 60 + 180 = 240/day works.
    expect(cu?.extraMinutesPerStudyDay).toBe(180)
  })

  it('has no required pace when no study days are left', () => {
    const sunday = { ...tight, today: '2026-10-11', targetDate: '2026-10-11' }
    const cu = suggestCatchUp(sunday)
    expect(cu).toMatchObject({
      studyDaysLeft: 0,
      requiredMinutesPerStudyDay: null,
      extraMinutesPerStudyDay: null,
    })
  })

  it('raises TARGET_IN_PAST when the target has passed and work remains', () => {
    const past = { ...tight, targetDate: '2026-10-01' }
    const res = ok(past)
    expect(res.issues).toContainEqual({ code: 'TARGET_IN_PAST' })
    expect(res.feasible).toBe(false)
    expect(suggestCatchUp(past, res)).toMatchObject({
      studyDaysLeft: 0,
      requiredMinutesPerStudyDay: null,
    })
    const doneAlready = { ...past, courses: [course('a', [0])] }
    expect(buildSchedule(doneAlready).issues).toEqual([])
  })

  it('caps the required pace at 16 h', () => {
    const absurd = { ...tight, courses: [course('a', [60 * 200])] }
    expect(suggestCatchUp(absurd)?.requiredMinutesPerStudyDay).toBeNull()
  })
})

describe('prerequisites', () => {
  it('schedules a prerequisite first even when its order is later', () => {
    const res = ok(
      input({
        courses: [
          course('b', [60], { order: 0, prerequisiteIds: ['a'] }),
          course('a', [60], { order: 1 }),
        ],
      }),
    )
    expect(courseOrder(res)).toEqual(['a', 'b'])
  })

  it('follows a chain C → B → A', () => {
    const res = ok(
      input({
        courses: [
          course('c', [60], { order: 0, prerequisiteIds: ['b'] }),
          course('b', [60], { order: 1, prerequisiteIds: ['a'] }),
          course('a', [60], { order: 2 }),
        ],
      }),
    )
    expect(courseOrder(res)).toEqual(['a', 'b', 'c'])
  })

  it('reports a cycle and still schedules everything, dependents after the cycle', () => {
    const res = ok(
      input({
        courses: [
          course('d', [60], { order: -1, prerequisiteIds: ['a'] }),
          course('a', [60], { order: 1, prerequisiteIds: ['b'] }),
          course('b', [60], { order: 0, prerequisiteIds: ['a'] }),
        ],
      }),
    )
    expect(res.issues).toContainEqual({ code: 'PREREQ_CYCLE', courseIds: ['b', 'a'] })
    expect(courseOrder(res)).toEqual(['b', 'a', 'd'])
    expect(res.totalMinutes).toBe(180)
  })

  it('reports a self-prerequisite as a cycle', () => {
    const res = orderCourses([
      { id: 'a', code: null, order: 0, status: 'todo', prerequisiteIds: ['a'] },
    ])
    expect(res.issues).toEqual([{ code: 'PREREQ_CYCLE', courseIds: ['a'] }])
    expect(res.order.map((c) => c.id)).toEqual(['a'])
  })

  it('reports an unknown prerequisite and ignores it', () => {
    const res = ok(input({ courses: [course('a', [60], { prerequisiteIds: ['ghost'] })] }))
    expect(res.issues).toEqual([{ code: 'UNKNOWN_PREREQ', courseId: 'a', prerequisiteId: 'ghost' }])
    expect(res.totalMinutes).toBe(60)
  })

  it('treats a prerequisite on a done course as satisfied', () => {
    const res = ok(
      input({
        courses: [
          course('b', [60], { order: 0, prerequisiteIds: ['a'] }),
          course('a', [60], { order: 1, status: 'done' }),
          course('c', [60], { order: 2 }),
        ],
      }),
    )
    expect(courseOrder(res)).toEqual(['b', 'c'])
    expect(res.issues).toEqual([])
  })

  it('puts the active course first among the ready ones', () => {
    const res = ok(
      input({
        courses: [
          course('a', [60], { order: 0 }),
          course('b', [60], { order: 1, status: 'active' }),
        ],
      }),
    )
    expect(courseOrder(res)).toEqual(['b', 'a'])
  })
})

describe('chunking', () => {
  it('avoids a tiny tail: 100 min on a 120-min day is 75 + 25', () => {
    const res = ok(input({ courses: [course('a', [100])], availability: avail(week(120)) }))
    expect(brief(res.chunks)).toEqual([
      [MONDAY, 'a-u1:1', 75],
      [MONDAY, 'a-u1:2', 25],
    ])
  })

  it('allows units shorter than 25 min', () => {
    const res = ok(input({ courses: [course('a', [15, 10])] }))
    expect(brief(res.chunks)).toEqual([
      [MONDAY, 'a-u1:1', 15],
      [MONDAY, 'a-u2:1', 10],
    ])
  })

  it('lowers the minimum to the largest day when every day is short (20 min/day)', () => {
    const res = ok(input({ courses: [course('a', [100])], availability: avail(week(20, 20, 20)) }))
    expect(res.chunks.map((c) => c.minutes)).toEqual([20, 20, 20, 20, 20])
    expect(res.projectedEnd).toBe('2026-10-09')
  })

  it('never splits below minEff on a short day unless it finishes the unit', () => {
    // Monday is 30 min, then 90-min days: 200 min is 30 | 90 | 80, never a piece under 25 mid-unit.
    const res = ok(
      input({
        courses: [course('a', [200])],
        availability: avail([90, 30, 90, 90, 90, 90, 90]),
      }),
    )
    expect(res.chunks.map((c) => c.minutes)).toEqual([30, 90, 80])
  })

  it('keeps every chunk within bounds on random plans (property)', () => {
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    const pick = (n: number) => Math.floor(rand() * n)
    for (let run = 0; run < 250; run++) {
      const minutes = Array.from(
        { length: 7 },
        () => [0, 15, 20, 30, 45, 60, 75, 90, 120, 180, 240][pick(11)] as number,
      ) as WeekMinutes
      if (minutes.every((m) => m === 0)) minutes[1] = 60
      const courses = Array.from({ length: 1 + pick(4) }, (_, i) =>
        course(
          `c${i}`,
          Array.from({ length: 1 + pick(4) }, () => 5 * (1 + pick(80))),
          { order: pick(3) },
        ),
      )
      const today = addDays(MONDAY, pick(40))
      const reservedMinutes: Record<ISODate, number> = pick(2) ? { [today]: 5 * pick(20) } : {}
      const pinned =
        pick(3) === 0
          ? [{ date: addDays(today, pick(10)), minutes: 5 * (1 + pick(12)), courseId: 'c0' }]
          : []
      const daysOff =
        pick(3) === 0
          ? [{ start: addDays(today, pick(10)), end: addDays(today, 10 + pick(10)) }]
          : []
      const first = courses[0]?.units[0]
      if (first && pick(3) === 0) first.deferredMinutes = 5 * (1 + pick(10))
      const inp = input({
        today,
        courses,
        availability: avail(minutes, daysOff),
        reservedMinutes,
        pinned,
        options: pick(2) ? {} : { minChunk: 30, maxChunk: 60 },
      })
      const res = buildSchedule(inp)
      expect(checkInvariants(inp, res), JSON.stringify(inp)).toEqual([])
    }
  })
})

describe('availability', () => {
  it('uses per-weekday hours and fills each day to its own limit', () => {
    const minutes: WeekMinutes = [0, 30, 45, 60, 90, 120, 150]
    const res = ok(input({ courses: [course('a', [2000])], availability: avail(minutes) }))
    const days = perDay(res)
    let short = 0
    for (const [date, sum] of Object.entries(days)) {
      const cap = minutes[weekdayOf(date)] as number
      expect(sum).toBeLessThanOrEqual(cap)
      if (sum < cap) short++
    }
    // Only the unit's last day or two (the tail rule) may be under the day's limit.
    expect(short).toBeLessThanOrEqual(2)
    expect(Object.keys(days).some((d) => weekdayOf(d) === 0)).toBe(false)
  })

  it('raises NO_AVAILABILITY with nothing scheduled', () => {
    const res = buildSchedule(input({ courses: [course('a', [60])], availability: avail(week(0)) }))
    expect(res).toMatchObject({
      chunks: [],
      projectedEnd: null,
      feasible: false,
      issues: [{ code: 'NO_AVAILABILITY' }],
    })
    // Under the grain counts as none.
    expect(
      buildSchedule(input({ courses: [course('a', [60])], availability: avail(week(4)) })).issues,
    ).toEqual([{ code: 'NO_AVAILABILITY' }])
  })

  it('raises HORIZON_EXCEEDED with the minutes it could not place', () => {
    const res = buildSchedule(input({ courses: [course('a', [600])], options: { horizonDays: 5 } }))
    expect(res.issues).toEqual([{ code: 'HORIZON_EXCEEDED', unscheduledMinutes: 300 }])
    expect(res).toMatchObject({ feasible: false, projectedEnd: null })
    expect(res.chunks).toHaveLength(5)
  })

  it('respects reserved minutes (today’s finished and skipped work)', () => {
    const res = ok(input({ courses: [course('a', [120])], reservedMinutes: { [MONDAY]: 45 } }))
    // 15 min left on Monday is under 25 and the unit needs more, so Monday gets nothing.
    expect(res.chunks[0]?.date).toBe('2026-10-06')
    const res2 = ok(input({ courses: [course('a', [120])], reservedMinutes: { [MONDAY]: 30 } }))
    expect(res2.chunks[0]).toMatchObject({ date: MONDAY, minutes: 30 })
  })

  it('lets a pinned task consume its day and count toward the end', () => {
    const base = input({ courses: [course('a', [120])], availability: avail(week(60)) })
    const res = ok({ ...base, pinned: [{ date: '2026-10-06', minutes: 60, courseId: 'a' }] })
    expect(perDay(res)['2026-10-06']).toBeUndefined()
    expect(brief(res.chunks)).toEqual([
      [MONDAY, 'a-u1:1', 60],
      ['2026-10-07', 'a-u1:2', 60],
    ])
    const late = ok({ ...base, pinned: [{ date: '2026-10-20', minutes: 30, courseId: 'a' }] })
    expect(late.projectedEnd).toBe('2026-10-20')
    expect(late.windows).toEqual([
      { courseId: 'a', start: MONDAY, end: '2026-10-20', minutes: 150 },
    ])
    const partial = ok({ ...base, pinned: [{ date: MONDAY, minutes: 45, courseId: 'a' }] })
    expect(perDay(partial)[MONDAY]).toBeUndefined()
  })

  it('has no duplicate or missing days across the DST changes (2026-11-01, 2027-03-14)', () => {
    const res = ok(
      input({
        today: '2026-10-25',
        courses: [
          course(
            'a',
            Array.from({ length: 30 }, () => 30 * 6),
          ),
        ],
        availability: avail([30, 30, 30, 30, 30, 30, 30]),
      }),
    )
    const dates = res.chunks.map((c) => c.date)
    expect(new Set(dates).size).toBe(dates.length)
    expect(dates).toEqual(eachDay('2026-10-25', res.projectedEnd as ISODate))
    expect(dates).toContain('2026-11-01')
    expect(dates).toContain('2027-03-14')
    expect(res.projectedEnd).toBe(addDays('2026-10-25', 179))
  })

  it('day numbers agree with date-fns local dates across DST and leap days', () => {
    let d = '2026-10-20'
    let n = dayNumber(d)
    for (let i = 0; i < 900; i++) {
      expect(isoOfDay(n)).toBe(d)
      expect(weekdayOfDay(n)).toBe(weekdayOf(d))
      d = addDays(d, 1)
      n += 1
    }
    expect(isoOfDay(dayNumber('2028-02-29') + 1)).toBe('2028-03-01')
    expect(dayNumber('1970-01-01')).toBe(0)
    expect(() => dayNumber('2026-02-30')).toThrow(RangeError)
  })
})

describe('skipping and keys', () => {
  it('keeps skipped minutes off today and fills today with what was already there', () => {
    // U has 90 left (two 45s today); the first 45 was skipped: today keeps one 45, the other moves.
    const res = ok(
      input({
        courses: [
          course('a', [unit('u', 90, { deferredMinutes: 45 }), unit('v', 60, { order: 1 })]),
        ],
        availability: avail(week(90)),
        reservedMinutes: { [MONDAY]: 45 },
      }),
    )
    expect(brief(res.chunks).slice(0, 2)).toEqual([
      [MONDAY, 'u:1', 45],
      ['2026-10-06', 'u:2', 45],
    ])
  })

  it('looks past a fully skipped unit for the rest of today', () => {
    const res = ok(
      input({
        courses: [
          course('a', [unit('u', 45, { deferredMinutes: 45 }), unit('v', 45, { order: 1 })]),
        ],
        availability: avail(week(90)),
        reservedMinutes: { [MONDAY]: 45 },
      }),
    )
    expect(brief(res.chunks)).toEqual([
      [MONDAY, 'v:1', 45],
      ['2026-10-06', 'u:1', 45],
    ])
  })

  it('numbers new chunks around the ones done or pinned (stable keys)', () => {
    const res = ok(input({ courses: [course('a', [unit('u', 120, { chunkSeqStart: 2 })])] }))
    expect(res.chunks.map((c) => [c.key, c.seqTotal])).toEqual([
      ['u:3', 4],
      ['u:4', 4],
    ])
    const holes = ok(
      input({ courses: [course('a', [unit('u', 180, { usedSeqs: [2], chunkSeqStart: 1 })])] }),
    )
    expect(holes.chunks.map((c) => c.key)).toEqual(['u:1', 'u:3', 'u:4'])
    expect(holes.chunks[1]?.title).toBe('A · Unit u (3/4)')
  })
})

describe('estimates', () => {
  it('resolveUnitEstimates shares the course’s leftover hours among units without estimates', () => {
    expect(
      resolveUnitEstimates({ estimateHours: 10 }, [
        { estimateMinutes: 120 },
        { estimateMinutes: null },
        { estimateMinutes: null },
        { estimateMinutes: null },
      ]),
    ).toEqual([120, 160, 160, 160])
    expect(
      resolveUnitEstimates({ estimateHours: 1 }, [
        { estimateMinutes: null },
        { estimateMinutes: null },
        { estimateMinutes: null },
      ]),
    ).toEqual([20, 20, 20])
    expect(
      resolveUnitEstimates({ estimateHours: 1 }, [
        { estimateMinutes: 90 },
        { estimateMinutes: null },
      ]),
    ).toEqual([90, 0])
    expect(resolveUnitEstimates({ estimateHours: 99 }, [{ estimateMinutes: 30 }])).toEqual([30])
    expect(
      resolveUnitEstimates({ estimateHours: 1.1 }, [
        { estimateMinutes: null },
        { estimateMinutes: null },
      ]),
    ).toEqual([35, 30])
  })

  it('computeRemaining subtracts done and pinned chunks and records their numbers', () => {
    const units = [
      { id: 'u', estimateMinutes: 240, done: false },
      { id: 'v', estimateMinutes: 100, done: true },
      { id: 'w', estimateMinutes: 60, done: false },
    ]
    const done = [
      {
        scheduleKey: 'u:1',
        unitId: 'u',
        milestoneId: 'c',
        estimateMinutes: 60,
        estimatePomodoros: 2,
      },
      {
        scheduleKey: 'u:3',
        unitId: 'u',
        milestoneId: 'c',
        estimateMinutes: null,
        estimatePomodoros: 2,
      },
      {
        scheduleKey: 'w:1',
        unitId: 'w',
        milestoneId: 'c',
        estimateMinutes: 90,
        estimatePomodoros: 4,
      },
    ]
    const pinned = [
      {
        scheduleKey: 'u:4',
        unitId: 'u',
        milestoneId: 'c',
        estimateMinutes: 33,
        estimatePomodoros: 1,
      },
    ]
    const r = computeRemaining(units, done, pinned)
    expect(r.get('u')).toEqual({
      remainingMinutes: 100,
      chunkSeqStart: 3,
      usedSeqs: [1, 3, 4],
      doneMinutes: 110,
      pinnedMinutes: 33,
    })
    expect(r.get('v')?.remainingMinutes).toBe(0)
    expect(r.get('w')?.remainingMinutes).toBe(0)
    expect(parseScheduleKey('unit-c779-3:2')).toEqual({ unitId: 'unit-c779-3', seq: 2 })
    expect(parseScheduleKey('nope')).toBeNull()
    expect(parseScheduleKey('u:0')).toBeNull()
  })

  it('resolveOptions keeps options sane', () => {
    expect(resolveOptions({ minChunk: 100, maxChunk: 60, grain: 0 })).toMatchObject({
      grain: 5,
      minChunk: 60,
      maxChunk: 60,
    })
  })
})

describe('planGoal (rows → plan)', () => {
  const rows = () => ({
    goal: goalRow({ availability: avail(week(90)), targetDate: '2026-12-31' }),
    milestones: [
      milestoneRow('a', { order: 0, status: 'active' as const }),
      milestoneRow('b', { order: 1, estimateHours: 3 }),
    ],
    units: [unitRow('a1', 'a', 180), unitRow('a2', 'a', 120, { order: 1 })],
    tasks: [],
  })

  it('schedules a course without units as one synthetic unit', () => {
    const plan = planGoal(rows(), MONDAY)
    const b = plan.result.chunks.filter((c) => c.courseId === 'b')
    expect(b.map((c) => [c.unitId, c.minutes])).toEqual([
      ['b', 60],
      ['b', 90],
      ['b', 30],
    ])
    expect(b[0]?.title).toBe('B · Study session (1/3)')
    expect(plan.work).toMatchObject({ totalMinutes: 480, doneMinutes: 0, remainingMinutes: 480 })
  })

  it('is idempotent: applying its diff and planning again changes nothing', () => {
    const first = planGoal(rows(), MONDAY)
    const tasks = applyDiff([], first.diff)
    expect(tasks).toHaveLength(first.result.chunks.length)
    const again = planGoal({ ...rows(), tasks }, MONDAY)
    expect(isDiffEmpty(again.diff)).toBe(true)
    expect(again.result).toEqual(first.result)
  })

  it('keeps today stable when a chunk is finished today, and moves a skipped one off today', () => {
    const first = planGoal(rows(), MONDAY)
    let tasks = applyDiff([], first.diff)
    const today = tasks.filter((t) => t.dueDate === MONDAY)
    expect(today).toHaveLength(1) // a1 90 fills Monday's 90
    tasks = completeTasks(tasks, [today[0]!.id], MONDAY)
    const afterDone = planGoal({ ...rows(), tasks }, MONDAY)
    expect(isDiffEmpty(afterDone.diff)).toBe(true)

    // Tuesday: two chunks of a1/a2? Skip the first one of Tuesday on Tuesday.
    const tue = '2026-10-06'
    const onTue = planGoal({ ...rows(), tasks }, tue)
    tasks = applyDiff(tasks, onTue.diff)
    const tuesday = tasks.filter((t) => t.dueDate === tue && t.status !== 'done')
    expect(tuesday.length).toBeGreaterThan(0)
    const skipped = tuesday[0]!
    tasks = tasks.map((t) => (t.id === skipped.id ? { ...t, skippedOn: tue } : t))
    const afterSkip = planGoal({ ...rows(), tasks }, tue)
    tasks = applyDiff(tasks, afterSkip.diff)
    const moved = tasks.find((t) => t.id === skipped.id)
    expect(moved?.dueDate).not.toBe(tue)
    expect((moved?.dueDate as string) > tue).toBe(true)
    const tueLoad = tasks.filter(
      (t) => t.dueDate === tue && t.status !== 'done' && t.skippedOn !== tue,
    )
    expect(tueLoad.reduce((s, t) => s + (t.estimateMinutes ?? 0), 0)).toBeLessThanOrEqual(
      90 - (skipped.estimateMinutes ?? 0),
    )
    // And again: nothing changes.
    expect(isDiffEmpty(planGoal({ ...rows(), tasks }, tue).diff)).toBe(true)
  })

  it('leaves a pinned task alone, uses its day, and releases the pin once its day has passed', () => {
    const first = planGoal(rows(), MONDAY)
    let tasks = applyDiff([], first.diff)
    const target = tasks.find((t) => t.dueDate === '2026-10-06')!
    tasks = tasks.map((t) =>
      t.id === target.id ? { ...t, dueDate: '2026-10-09', schedulePinned: true } : t,
    )
    const pinnedPlan = planGoal({ ...rows(), tasks }, MONDAY)
    expect(pinnedPlan.diff.keep).toContain(target.id)
    tasks = applyDiff(tasks, pinnedPlan.diff)
    const fri = tasks.filter((t) => t.dueDate === '2026-10-09')
    expect(fri.reduce((s, t) => s + (t.estimateMinutes ?? 0), 0)).toBeLessThanOrEqual(90)
    expect(isDiffEmpty(planGoal({ ...rows(), tasks }, MONDAY).diff)).toBe(true)

    const later = planGoal({ ...rows(), tasks }, '2026-10-12')
    const released = later.diff.update.find((u) => u.id === target.id)
    expect(released?.changes.schedulePinned).toBe(false)
  })

  it('writes the projection with catch-up numbers and course dates', () => {
    const plan = planGoal(
      { ...rows(), goal: goalRow({ availability: avail(week(30)), targetDate: '2026-10-09' }) },
      MONDAY,
    )
    expect(plan.projection.feasible).toBe(false)
    expect(plan.projection.catchUpMinutes).toBeTypeOf('number')
    expect(plan.projection.requiredMinutesPerStudyDay).toBeTypeOf('number')
    expect(plan.courseDates.get('a')?.start).toBe(MONDAY)
    expect(plan.projection.issues).toEqual([])
  })

  it('adopts the hand-written keys of existing tasks', () => {
    const tasks = [
      taskRow('done-1', {
        status: 'done',
        scheduleKey: 'a1:1',
        unitId: 'a1',
        milestoneId: 'a',
        estimateMinutes: 60,
        completedDay: '2026-10-01',
      }),
      taskRow('open-2', {
        scheduleKey: 'a1:2',
        unitId: 'a1',
        milestoneId: 'a',
        estimateMinutes: 45,
        dueDate: '2026-10-02',
      }),
    ]
    const plan = planGoal({ ...rows(), tasks }, MONDAY)
    expect(plan.diff.remove).toEqual([])
    expect(plan.diff.update.find((u) => u.id === 'open-2')?.chunk.key).toBe('a1:2')
    expect(plan.courseDates.get('a')?.start).toBe('2026-10-01')
    expect(plan.work.courses[0]).toMatchObject({ totalMinutes: 300, doneMinutes: 60 })
  })
})

describe('performance', () => {
  it('schedules a 12-course, one-year WGU plan in under 50 ms', () => {
    const inp = wguYearPlan()
    buildSchedule(inp) // warm-up
    const t0 = performance.now()
    const res = buildSchedule(inp)
    const ms = performance.now() - t0
    expect(checkInvariants(inp, res)).toEqual([])
    expect(res.feasible).toBe(true)
    expect(res.projectedEnd! > '2027-07-01').toBe(true)
    expect(res.chunks.length).toBeGreaterThan(250)
    expect(ms).toBeLessThan(50)
  })

  it('plans with catch-up in under 50 ms when the target is missed', () => {
    const inp = { ...wguYearPlan(), targetDate: '2027-06-30' }
    suggestCatchUp(inp)
    const t0 = performance.now()
    const res = buildSchedule(inp)
    const cu = suggestCatchUp(inp, res)
    const ms = performance.now() - t0
    expect(res.feasible).toBe(false)
    expect(cu?.extraMinutesPerStudyDay).toBeTypeOf('number')
    expect(ms).toBeLessThan(50)
  })
})
