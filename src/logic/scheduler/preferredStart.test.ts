/**
 * `PlannerSettings.preferredStartMinutes` (Phase 11b): the first study session of a day starts at the
 * hour the person focuses best when a free slot holds it there. Absent, nothing changes.
 */
import { describe, expect, it } from 'vitest'
import { avail, goalRow, milestoneRow, unitRow, week } from './fixtures'
import { goalPlannerInput } from './goalSlots'
import { DEFAULT_PLANNER_SETTINGS, planStudy, resolvePlannerSettings } from './planner'
import { avail2, checkPlan, MON, pcourse, pinput, weekWin, win } from './plannerFixtures'
import type { PlanItem, PlannerInput } from './plannerTypes'

/** Hour of the day as planner minutes. */
const H = (hour: number): number => hour * 60

/** Mon-Fri: an early hour and the evening; a paced plan (target set) so the preference can apply. */
function paced(preferred?: number, extra: Partial<PlannerInput> = {}): PlannerInput {
  return pinput({
    courses: [pcourse('c182', [250, 250])],
    targetDate: '2026-10-16',
    availability: avail2(weekWin(win(['07:00', '08:00'], ['18:00', '20:00']))),
    ...extra,
    settings: preferred === undefined ? {} : { preferredStartMinutes: preferred },
  })
}

/** Each day's first session start, by date. */
function firstOfDay(items: readonly PlanItem[]): Record<string, string | null> {
  const first: Record<string, string | null> = {}
  for (const i of items) {
    if (i.kind !== 'study') continue
    const seen = first[i.doDate]
    if (seen === undefined || (i.startTime !== null && (seen === null || i.startTime < seen))) {
      first[i.doDate] = i.startTime
    }
  }
  return first
}

describe('preferredStartMinutes', () => {
  it('defaults to no preference, and a missing, null or non-finite value means none', () => {
    expect(DEFAULT_PLANNER_SETTINGS.preferredStartMinutes).toBeNull()
    expect(resolvePlannerSettings().preferredStartMinutes).toBeNull()
    expect(resolvePlannerSettings({ preferredStartMinutes: null }).preferredStartMinutes).toBeNull()
    expect(
      resolvePlannerSettings({ preferredStartMinutes: Number.NaN }).preferredStartMinutes,
    ).toBeNull()
  })

  it('is kept as whole minutes inside the day', () => {
    expect(resolvePlannerSettings({ preferredStartMinutes: H(18) }).preferredStartMinutes).toBe(
      1080,
    )
    expect(resolvePlannerSettings({ preferredStartMinutes: 1080.4 }).preferredStartMinutes).toBe(
      1080,
    )
    expect(resolvePlannerSettings({ preferredStartMinutes: -30 }).preferredStartMinutes).toBe(0)
    expect(resolvePlannerSettings({ preferredStartMinutes: 5000 }).preferredStartMinutes).toBe(1439)
  })

  it('changes nothing when absent: the plan is deep-equal to one that never heard of it', () => {
    const without = planStudy(paced())
    expect(planStudy(paced(undefined, { settings: { preferredStartMinutes: null } }))).toEqual(
      without,
    )
  })

  it('starts each day at the preferred hour when a window holds it', () => {
    const base = planStudy(paced())
    const early = firstOfDay(base.items)
    // Without a preference the earliest slot, 07:00, opens every day that has a session.
    expect(Object.keys(early).length).toBeGreaterThan(3)
    expect(Object.values(early).every((t) => t === '07:00')).toBe(true)

    const res = planStudy(paced(H(18)))
    const preferred = firstOfDay(res.items)
    expect(Object.keys(preferred)).toEqual(Object.keys(early))
    expect(Object.values(preferred).every((t) => t === '18:00')).toBe(true)
    expect(checkPlan(paced(H(18)), res)).toEqual([])
  })

  it('still finishes the same work on the same day', () => {
    const base = planStudy(paced())
    const res = planStudy(paced(H(18)))
    expect(res.totals).toEqual(base.totals)
    expect(res.projectedEnd).toBe(base.projectedEnd)
    expect(res.fits).toBe(base.fits)
  })

  it('does nothing when the hour falls between windows', () => {
    const base = planStudy(paced())
    expect(planStudy(paced(H(12))).items).toEqual(base.items)
  })

  it('needs a slot that starts there: a window that begins later is used from its own start', () => {
    const av = avail2(weekWin(win(['07:00', '08:00'], ['18:30', '20:00'])))
    const base = planStudy(paced(undefined, { availability: av }))
    // 18:00 is a gap between windows, so the day still opens at 07:00.
    expect(planStudy(paced(H(18), { availability: av })).items).toEqual(base.items)
  })

  it('can start inside a window, not only at its edge', () => {
    const av = avail2(weekWin(win(['17:00', '20:00'])))
    const res = planStudy(paced(H(18), { availability: av }))
    const preferred = firstOfDay(res.items)
    expect(Object.keys(preferred).length).toBeGreaterThan(3)
    expect(Object.values(preferred).every((t) => t === '18:00')).toBe(true)
    expect(checkPlan(paced(H(18), { availability: av }), res)).toEqual([])
  })

  it('never trades planned minutes for the preferred hour', () => {
    // Three hours a day and a pace of two of them: starting at 19:00 would leave only one, so the day
    // opens at 17:00 as it always did, and the plan keeps its pace and finish.
    const tight = (preferred?: number) =>
      pinput({
        courses: [pcourse('d278', [300, 300])],
        targetDate: '2026-10-09',
        availability: avail2(weekWin(win(['17:00', '20:00']))),
        settings: preferred === undefined ? {} : { preferredStartMinutes: preferred },
      })
    const base = planStudy(tight())
    expect(base.pace).toEqual({ mode: 'target', minutesPerStudyDay: 120 })
    expect(planStudy(tight(H(19)))).toEqual(base)
  })

  it('does use a start that leaves the day room for its pace', () => {
    // The same three hours, but one 50-minute session a day: 19:00 still holds a whole day's work.
    const easy = (preferred?: number) =>
      pinput({
        courses: [pcourse('d278', [50, 50, 50, 50, 50])],
        targetDate: '2026-10-09',
        availability: avail2(weekWin(win(['17:00', '20:00']))),
        settings: preferred === undefined ? {} : { preferredStartMinutes: preferred },
      })
    const res = planStudy(easy(H(19)))
    expect(res.pace.mode).toBe('target')
    const first = firstOfDay(res.items)
    expect(Object.keys(first).length).toBeGreaterThan(3)
    expect(Object.values(first).every((t) => t === '19:00')).toBe(true)
    expect(res.fits).toBe(true)
    expect(checkPlan(easy(H(19)), res)).toEqual([])
  })

  it('leaves an ASAP plan alone', () => {
    const asap = (preferred?: number) =>
      pinput({
        courses: [pcourse('c779', [200])],
        availability: avail2(weekWin(win(['07:00', '08:00'], ['18:00', '20:00']))),
        settings: preferred === undefined ? {} : { preferredStartMinutes: preferred },
      })
    expect(planStudy(asap(H(18))).items).toEqual(planStudy(asap()).items)
  })

  it('is not used for a start that has already passed today', () => {
    // 09:30 today with a preference of 07:00: today opens after now, later days at 07:00.
    const now = new Date(2026, 9, 5, 9, 30).getTime()
    const res = planStudy(paced(H(7), { now }))
    const first = firstOfDay(res.items)
    expect(first[MON]).not.toBe('07:00')
    expect(checkPlan(paced(H(7), { now }), res)).toEqual([])
  })
})

describe("from a goal's stored rows", () => {
  const stored = {
    goal: goalRow({ availability: avail(week(60, 120, 0), []) }),
    milestones: [milestoneRow('a', { order: 0, status: 'active' as const })],
    units: [unitRow('a1', 'a', 120)],
    tasks: [],
  }

  it('hands the preferred start to the planner', () => {
    const { input } = goalPlannerInput({ ...stored, preferredStartMinutes: H(9) }, MON)
    expect(input.settings).toMatchObject({ preferredStartMinutes: 540 })
  })

  it('adds nothing when there is none: the input is as it always was', () => {
    const plain = goalPlannerInput(stored, MON).input
    expect(plain.settings).not.toHaveProperty('preferredStartMinutes')
    expect(goalPlannerInput({ ...stored, preferredStartMinutes: null }, MON).input).toEqual(plain)
  })
})
