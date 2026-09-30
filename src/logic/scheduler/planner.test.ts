import { describe, expect, it } from 'vitest'
import type { ISODate } from '@/db/types'
import { atTime, weekdayOf } from '../dates'
import { planRun, planStudy } from './planner'
import {
  avail2,
  checkPlan,
  MON,
  pcourse,
  pinput,
  punit,
  rng,
  rows,
  weekWin,
  win,
  wguPlannerInput,
} from './plannerFixtures'
import type { DayWindows, PlanItem, PlannerInput, PlannerResult } from './plannerTypes'
import { shiftCycle, SHIFT_PRESETS } from './windows'

const ok = (inp: PlannerInput, order?: string[]): PlannerResult => {
  const res = planStudy(inp)
  expect(checkPlan(inp, res, order)).toEqual([])
  return res
}
const of = (res: PlannerResult, kind: PlanItem['kind']) => res.items.filter((i) => i.kind === kind)
const keyed = (res: PlannerResult, key: string) => res.items.find((i) => i.key === key)

describe('planStudy: normal plan', () => {
  // Evenings Mon–Fri 18:00–20:00, 50-min sessions, 10-min breaks, ASAP.
  const basic = () =>
    pinput({ courses: [pcourse('a', [100, 50], { order: 0 }), pcourse('b', [100], { order: 1 })] })

  it('places sessions into the windows in order, matching the hand-computed plan', () => {
    const res = ok(basic(), ['a', 'b'])
    expect(rows(res.items)).toEqual([
      ['2026-10-05', '18:00', 'a-u1:1', 50],
      ['2026-10-05', '19:00', 'a-u1:2', 50],
      ['2026-10-06', '18:00', 'a-u2:1', 50],
      ['2026-10-06', '19:00', 'b-u1:1', 50],
      ['2026-10-07', '18:00', 'b-u1:2', 50],
    ])
    expect(res.projectedEnd).toBe('2026-10-07')
    expect(res.pace).toEqual({ mode: 'asap', minutesPerStudyDay: null })
    expect(res.fits).toBe(true)
    expect(res.totals).toEqual({ study: 250, review: 0, practiceTest: 0, assessment: 0, work: 250 })
    expect(keyed(res, 'a-u1:2')?.title).toBe('A · Topic 1 (2/2)')
    expect(res.courseWindows).toEqual([
      { courseId: 'a', start: '2026-10-05', end: '2026-10-06', minutes: 150 },
      { courseId: 'b', start: '2026-10-06', end: '2026-10-07', minutes: 100 },
    ])
  })

  it('is deterministic: two runs and shuffled input give deep-equal output', () => {
    const inp = basic()
    const shuffled = { ...inp, courses: [...inp.courses].reverse().map((c) => ({ ...c, units: [...c.units].reverse() })) }
    expect(planStudy(inp)).toEqual(planStudy(inp))
    expect(planStudy(shuffled)).toEqual(planStudy(inp))
  })

  it('numbers new sessions around the ones done or pinned (stable keys)', () => {
    const res = ok(pinput({ courses: [pcourse('a', [punit('u', 150, { usedSeqs: [2] })])] }))
    expect(of(res, 'study').map((i) => [i.key, i.seq, i.seqTotal])).toEqual([
      ['u:1', 1, 4],
      ['u:3', 3, 4],
      ['u:4', 4, 4],
    ])
  })

  it('does not use today before `now`, and drops the break when only back-to-back fits', () => {
    const now = atTime(MON, '18:17')
    const res = ok(pinput({ now, courses: [pcourse('a', [120])] }))
    expect(rows(res.items)).toEqual([
      ['2026-10-05', '18:20', 'a-u1:1', 60],
      ['2026-10-06', '18:00', 'a-u1:2', 60],
    ])
    const later = ok(pinput({ courses: [pcourse('a', [120])] }))
    expect(rows(later.items)).toEqual([
      ['2026-10-05', '18:00', 'a-u1:1', 60],
      ['2026-10-05', '19:00', 'a-u1:2', 60], // 19:10 would run past 20:00
    ])
  })

  it('schedules a prerequisite first even when its order is later', () => {
    const res = ok(
      pinput({
        courses: [
          pcourse('b', [100], { order: 0, prerequisiteIds: ['a'] }),
          pcourse('a', [100], { order: 1 }),
        ],
      }),
      ['a', 'b'],
    )
    expect(res.courseWindows.map((w) => w.courseId)).toEqual(['a', 'b'])
  })

  it('uses a legacy minutes-per-weekday availability', () => {
    const inp = wguPlannerInput()
    const res = ok(inp)
    expect(res.fits).toBe(true)
    expect(res.items.every((i) => i.doDate >= inp.today)).toBe(true)
  })
})

describe('planStudy: slot placement', () => {
  it('never crosses a window end, never overlaps busy or pinned time (property)', () => {
    const r = rng(42)
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
    for (let run = 0; run < 60; run++) {
      const day = (): DayWindows => {
        const n = Math.floor(r() * 3)
        const out: Array<{ start: string; end: string }> = []
        let t = 6 * 60 + Math.floor(r() * 4) * 60
        for (let k = 0; k < n && t < 22 * 60; k++) {
          const len = 20 + Math.floor(r() * 26) * 5
          const end = Math.min(24 * 60, t + len)
          const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
          out.push({ start: hh(t), end: end === 1440 ? '24:00' : hh(end) })
          t = end + 30 + Math.floor(r() * 5) * 30
        }
        return out
      }
      const weekly = [day(), day(), day(), day(), day(), day(), day()] as const
      if (weekly.every((d) => d.length === 0)) continue
      const busy = Array.from({ length: 8 }, (_, i) => ({
        date: `2026-10-${String(5 + Math.floor(r() * 20)).padStart(2, '0')}`,
        start: pick(['07:00', '08:30', '12:00', '18:00', '18:45', '20:15']),
        durationMinutes: 15 + Math.floor(r() * 10) * 15,
        id: `b${i}`,
      }))
      const inp: PlannerInput = {
        today: MON,
        targetDate: null,
        availability: avail2(weekly, { sessionMinutes: pick([25, 45, 50, 60, 90]) }),
        courses: [
          pcourse('a', [Math.floor(r() * 60) * 5 + 5, Math.floor(r() * 80) * 5], { order: 0 }),
          pcourse('b', [Math.floor(r() * 100) * 5 + 30], { order: 1, extraReviewMinutes: pick([0, 30, 60]) }),
        ],
        assessments: [
          { id: 'x', courseId: 'a', kind: 'exam', title: 'Exam', date: null },
          { id: 'y', courseId: 'b', kind: 'quiz', title: 'Quiz', date: '2026-11-20' },
        ],
        blockedSlots: busy,
        pinned: [{ key: 'p:1', kind: 'study', courseId: 'a', date: '2026-10-06', startTime: '19:00', durationMinutes: 40 }],
        settings: { bufferPct: 0.12 },
      }
      const res = planStudy(inp)
      expect(checkPlan(inp, res, ['a', 'b'])).toEqual([])
      for (const it of of(res, 'study')) expect(it.durationMinutes).toBeLessThanOrEqual(90)
    }
  })

  it('works around busy blocks, everyday tasks with a time, and pinned items', () => {
    const inp = pinput({
      courses: [pcourse('a', [150])],
      blockedSlots: [
        { date: MON, start: '18:30', durationMinutes: 30, source: 'task' },
        { date: '2026-10-06', start: '17:00', durationMinutes: 90, source: 'calendar' },
      ],
      pinned: [{ key: 'q:1', kind: 'study', courseId: 'a', date: '2026-10-07', startTime: '18:00', durationMinutes: 60 }],
    })
    const res = ok(inp)
    expect(rows(res.items)).toEqual([
      ['2026-10-05', '18:00', 'a-u1:1', 30], // fills the gap before the busy block
      ['2026-10-05', '19:00', 'a-u1:2', 60],
      ['2026-10-06', '18:30', 'a-u1:3', 60], // after the calendar event
    ])
    // The pinned item counts toward the end and the course window.
    expect(res.courseWindows[0]).toMatchObject({ start: '2026-10-05', end: '2026-10-07', minutes: 210 })
  })

  it('places nothing on blackout days', () => {
    const inp = pinput({
      courses: [pcourse('a', [400])],
      availability: avail2(weekWin(win(['18:00', '20:00'])), {
        blackouts: [{ start: '2026-10-06', end: '2026-10-08', label: 'Trip' }],
      }),
    })
    const res = ok(inp)
    expect(res.items.some((i) => i.doDate >= '2026-10-06' && i.doDate <= '2026-10-08')).toBe(false)
    expect(res.projectedEnd).toBe('2026-10-13')
  })

  it('follows a rotating shift pattern across cycle wraps', () => {
    // 3 on / 4 off from Thursday 2026-10-01: study only on days off, 09:00–12:00.
    const cycle = shiftCycle(SHIFT_PRESETS['3on4off'], null, win(['09:00', '12:00']))
    const inp = pinput({
      courses: [pcourse('a', [1500])],
      availability: avail2(weekWin(win(['18:00', '20:00'])), { shiftPattern: { anchor: '2026-10-01', cycle } }),
    })
    const res = ok(inp)
    const days = [...new Set(res.items.filter((i) => i.kind === 'study').map((i) => i.doDate))]
    // Off runs: Oct 4–7, Oct 11–14, Oct 18–21, … (the anchor's cycle, not the weekdays).
    expect(days.slice(0, 9)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-18',
      '2026-10-19',
    ])
    expect(of(res, 'study').every((i) => i.startTime !== null && i.startTime >= '09:00')).toBe(true)
  })

  it('handles the DST changes: no duplicate or missing days, and never the skipped or repeated hour', () => {
    // Sundays 00:00–04:00 only, from 2026-10-25 to past 2027-03-14.
    const sundays: DayWindows = win(['00:00', '04:00'])
    const inp: PlannerInput = {
      today: '2026-10-25',
      targetDate: null,
      availability: avail2([sundays, [], [], [], [], [], []]),
      courses: [pcourse('a', [Array.from({ length: 22 }).length * 200])],
      settings: { bufferPct: 0 },
    }
    const res = ok(inp)
    const study = of(res, 'study')
    expect(study.every((i) => weekdayOf(i.doDate) === 0)).toBe(true)
    const nov1 = study.filter((i) => i.doDate === '2026-11-01').map((i) => i.startTime)
    const mar14 = study.filter((i) => i.doDate === '2027-03-14').map((i) => i.startTime)
    expect(nov1).toEqual(['00:00', '02:00', '03:00']) // 01:00–02:00 happens twice: not used
    expect(mar14).toEqual(['00:00', '01:00', '03:00']) // 02:00–03:00 does not exist
    const ord = study.filter((i) => i.doDate === '2026-11-08').map((i) => i.startTime)
    expect(ord).toEqual(['00:00', '01:00', '02:00', '03:00'])
    // Wall-clock length is real length: each session's instants are exactly its minutes apart.
    for (const i of study) {
      const start = atTime(i.doDate, i.startTime as string)
      const [h, m] = (i.startTime as string).split(':').map(Number) as [number, number]
      const endWall = h * 60 + m + i.durationMinutes
      const end = atTime(i.doDate, `${String(Math.floor(endWall / 60)).padStart(2, '0')}:${String(endWall % 60).padStart(2, '0')}`)
      expect((end - start) / 60000).toBe(i.durationMinutes)
    }
  })
})

describe('planStudy: buffer and pace', () => {
  const work = () =>
    pinput({ courses: [pcourse('a', [500, 500])], settings: { bufferPct: 0.12 } }) // 1000 min

  it('reserves 12 % of the work as free time after the last session', () => {
    const res = ok(work())
    expect(res.buffer).toEqual({ pct: 0.12, minutes: 120, bufferedEnd: '2026-10-19' })
    expect(res.projectedEnd).toBe('2026-10-16') // 20 sessions, 2 a day, Mon–Fri
    // Buffer walks the free time left: Fri after the last session is full, Mon 100 min, Tue 20 more.
  })

  it('fits a target only with the buffer', () => {
    expect(planStudy({ ...work(), targetDate: '2026-10-16' }).fits).toBe(false)
    expect(planStudy({ ...work(), targetDate: '2026-10-19' }).fits).toBe(true)
    expect(planStudy({ ...work(), targetDate: '2026-10-19', settings: { bufferPct: 0 } }).buffer.minutes).toBe(0)
  })

  it('ASAP finishes earliest; a target spreads the work at the smallest verified pace', () => {
    const asap = ok(work())
    const inp = { ...work(), targetDate: '2026-11-30' }
    const paced = ok(inp)
    expect(paced.pace.mode).toBe('target')
    const pace = paced.pace.minutesPerStudyDay as number
    expect(pace).toBeGreaterThan(0)
    expect(pace).toBeLessThan(100)
    expect(paced.fits).toBe(true)
    expect((paced.buffer.bufferedEnd as string) <= '2026-11-30').toBe(true)
    expect((paced.projectedEnd as string) > (asap.projectedEnd as string)).toBe(true)
    expect(planRun(inp, pace - 5).fits).toBe(false)
    expect(planRun(inp, pace).fits).toBe(true)
    // No study day goes over pace + one session.
    const perDay = new Map<string, number>()
    for (const i of of(paced, 'study')) perDay.set(i.doDate, (perDay.get(i.doDate) ?? 0) + i.durationMinutes)
    for (const m of perDay.values()) expect(m).toBeLessThanOrEqual(pace + 50)
  })

  it('falls back to ASAP and does not fit when even that misses the target', () => {
    const res = planStudy({ ...work(), targetDate: '2026-10-09' })
    expect(res.fits).toBe(false)
    expect(res.pace).toEqual({ mode: 'target', minutesPerStudyDay: null })
    expect(res.projectedEnd).toBe('2026-10-16')
    expect(res.slipDays).toBe(7)
  })

  it('reports no availability and a target in the past', () => {
    const none = planStudy(pinput({ courses: [pcourse('a', [100])], availability: avail2(weekWin([])) }))
    expect(none.issues).toContainEqual({ code: 'NO_AVAILABILITY' })
    expect(none.fits).toBe(false)
    expect(none.projectedEnd).toBeNull()
    const past = planStudy(pinput({ courses: [pcourse('a', [100])], targetDate: '2026-10-01' }))
    expect(past.issues).toContainEqual({ code: 'TARGET_IN_PAST' })
    expect(past.fits).toBe(false)
  })
})

describe('planStudy: assessments, reviews and practice tests', () => {
  it('spaces reviews at −7, −3, −1 study days and a practice test at −2 before a dated exam', () => {
    const inp = pinput({
      courses: [pcourse('a', [300])],
      assessments: [{ id: 'x', courseId: 'a', kind: 'exam', title: 'Objective assessment', date: '2026-10-30', time: '09:00' }],
    })
    const res = ok(inp)
    const extra = res.items.filter((i) => i.assessmentId === 'x').map((i) => [i.key, i.kind, i.doDate, i.startTime, i.durationMinutes])
    expect(extra).toEqual([
      ['review:x:1', 'review', '2026-10-21', '18:00', 30],
      ['review:x:2', 'review', '2026-10-27', '18:00', 30],
      ['practice:x', 'practiceTest', '2026-10-28', '18:00', 60],
      ['review:x:3', 'review', '2026-10-29', '18:00', 30],
      ['assessment:x', 'assessment', '2026-10-30', '09:00', 120],
    ])
    expect(keyed(res, 'review:x:1')).toMatchObject({ title: 'A · Review for Objective assessment (1/3)', dueDate: '2026-10-30' })
    expect(keyed(res, 'practice:x')?.title).toBe('A · Practice test: Objective assessment')
    expect(res.projectedEnd).toBe('2026-10-30')
  })

  it('scales the offsets to the study days left, and deduplicates', () => {
    const inp = pinput({
      courses: [pcourse('a', [50])],
      assessments: [{ id: 'x', courseId: 'a', kind: 'exam', title: 'Exam', date: '2026-10-09' }],
    })
    const res = ok(inp)
    // 4 study days before Friday: offsets [7, 3, 1] → [4, 2, 1]; −2 is the practice test.
    expect(res.items.filter((i) => i.assessmentId === 'x').map((i) => [i.key, i.doDate, i.startTime])).toEqual([
      ['review:x:1', '2026-10-05', '18:00'],
      ['practice:x', '2026-10-07', '18:00'],
      ['review:x:2', '2026-10-08', '18:00'],
      ['assessment:x', '2026-10-09', null], // no booked time: a day marker
    ])
    expect(keyed(res, 'assessment:x')?.durationMinutes).toBe(0)
  })

  it('gives a quiz one review the study day before and a project one two days before; no practice test', () => {
    const res = ok(
      pinput({
        courses: [pcourse('a', [100])],
        assessments: [
          { id: 'q', courseId: 'a', kind: 'quiz', title: 'Quiz 3', date: '2026-10-14' },
          { id: 'p', courseId: 'a', kind: 'project', title: 'Project', date: '2026-10-16' },
        ],
      }),
    )
    expect(res.items.filter((i) => i.assessmentId !== null).map((i) => [i.key, i.doDate])).toEqual([
      ['review:q:1', '2026-10-13'],
      ['review:p:1', '2026-10-14'],
      ['assessment:q', '2026-10-14'], // a day marker: after the day's timed items
      ['assessment:p', '2026-10-16'],
    ])
  })

  it('places an undated exam on the study day after its course, with its reviews before it', () => {
    const inp = pinput({
      courses: [pcourse('a', [400], { order: 0 }), pcourse('b', [100], { order: 1 })],
      assessments: [{ id: 'x', courseId: 'a', kind: 'exam', title: 'OA', date: null, durationMinutes: 90 }],
    })
    const res = ok(inp, ['a', 'b'])
    const a = res.items.filter((i) => i.courseId === 'a' && i.kind !== 'assessment')
    const lastA = a.map((i) => i.doDate).sort().at(-1) as ISODate
    const exam = keyed(res, 'assessment:x') as PlanItem
    expect(exam.doDate > lastA).toBe(true)
    expect(exam.startTime).toBe('18:00')
    expect(exam.durationMinutes).toBe(90)
    expect(res.items.filter((i) => i.assessmentId === 'x' && i.kind !== 'assessment').map((i) => i.key).sort()).toEqual([
      'practice:x',
      'review:x:1',
      'review:x:2',
    ])
    // Course B's work continues right after A's, and does not wait for the exam.
    const firstB = of(res, 'study').find((i) => i.courseId === 'b') as PlanItem
    expect(firstB.doDate <= exam.doDate).toBe(true)
  })

  it('skips generated items already done, and flags a dated exam that comes before its study ends', () => {
    const res = planStudy(
      pinput({
        courses: [pcourse('a', [600])],
        assessments: [{ id: 'x', courseId: 'a', kind: 'exam', title: 'Exam', date: '2026-10-08' }],
        completedKeys: ['practice:x'],
      }),
    )
    expect(keyed(res, 'practice:x')).toBeUndefined()
    expect(res.issues).toContainEqual({ code: 'ASSESSMENT_TOO_EARLY', assessmentId: 'x', lastStudyDate: expect.any(String) })
    expect(res.fits).toBe(false)
    const past = planStudy(
      pinput({ courses: [pcourse('a', [50])], assessments: [{ id: 'old', courseId: 'a', kind: 'exam', title: 'E', date: '2026-10-01' }] }),
    )
    expect(past.issues).toContainEqual({ code: 'ASSESSMENT_IN_PAST', assessmentId: 'old' })
  })

  it('adds readiness review sessions after a unit and after a course (extraReviewMinutes hook)', () => {
    const res = ok(
      pinput({
        courses: [
          pcourse('a', [punit('a1', 50, { order: 0, title: 'Networks', extraReviewMinutes: 30 }), punit('a2', 50, { order: 1 })], {
            order: 0,
            extraReviewMinutes: 60,
          }),
          pcourse('b', [50], { order: 1 }),
        ],
      }),
    )
    expect(rows(res.items).map((r) => r[2])).toEqual(['a1:1', 'extra:a1:1', 'a2:1', 'extra:a:1', 'b-u1:1'])
    expect(keyed(res, 'extra:a1:1')).toMatchObject({ kind: 'review', title: 'A · Review: Networks', unitId: 'a1' })
    expect(keyed(res, 'extra:a:1')).toMatchObject({ kind: 'review', title: 'A · Review', unitId: null })
    expect(res.totals.review).toBe(90)
  })
})

describe('planStudy: weekly milestones', () => {
  it('says what each week finishes, dated on its last study day', () => {
    const res = ok(pinput({ courses: [pcourse('a', [250, 250, 250])] }))
    expect(of(res, 'milestone').map((m) => [m.key, m.doDate, m.title])).toEqual([
      ['milestone:2026-10-05', '2026-10-09', 'Week of Oct 5 — finish A Units 1–2'],
      ['milestone:2026-10-12', '2026-10-14', 'Week of Oct 12 — finish A Unit 3'],
    ])
    expect(of(res, 'milestone')[0]).toMatchObject({ startTime: null, durationMinutes: 0, dueDate: '2026-10-09' })
  })

  it('says "continue" for a week that finishes nothing, and names assessments and review weeks', () => {
    const res = ok(
      pinput({
        courses: [pcourse('a', [1500]), pcourse('b', [punit('b', 100)], { order: 1 })],
        assessments: [{ id: 'x', courseId: 'b', kind: 'exam', title: 'Final', date: '2026-11-13' }],
      }),
    )
    expect(of(res, 'milestone').map((m) => m.title)).toEqual([
      'Week of Oct 5 — continue A Unit 1',
      'Week of Oct 12 — continue A Unit 1',
      'Week of Oct 19 — finish A Unit 1',
      'Week of Oct 26 — finish B',
      'Week of Nov 2 — review',
      'Week of Nov 9 — review and practice test; B Final',
    ])
  })
})

describe('performance', () => {
  it('plans a 12-course year with slots, reviews and milestones in under 50 ms', () => {
    const inp = wguPlannerInput()
    planStudy(inp) // warm-up
    const t0 = performance.now()
    const res = planStudy(inp)
    const ms = performance.now() - t0
    expect(checkPlan(inp, res)).toEqual([])
    expect(res.fits).toBe(true)
    expect(of(res, 'study').length).toBeGreaterThan(500)
    expect(of(res, 'assessment')).toHaveLength(12)
    expect(ms).toBeLessThan(50)
  })

  it('plans the same year ASAP in under 50 ms', () => {
    const inp = { ...wguPlannerInput(), targetDate: null }
    planStudy(inp)
    const t0 = performance.now()
    planStudy(inp)
    expect(performance.now() - t0).toBeLessThan(50)
  })
})
