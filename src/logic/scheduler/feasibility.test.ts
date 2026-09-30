import { describe, expect, it } from 'vitest'
import { addDays } from '../dates'
import { checkFeasibility, cutCandidates, formatDuration, withoutUnits } from './feasibility'
import { planRun, planStudy } from './planner'
import { pcourse, pinput, punit } from './plannerFixtures'
import type { PlannerInput } from './plannerTypes'
import { addMinutesToWindows } from './windows'

// 1500 min over two courses; evenings Mon–Fri give 100 min of study a day, so it ends Friday Oct 23.
const plan = (targetDate: string | null): PlannerInput =>
  pinput({
    courses: [
      pcourse('a', [punit('a1', 300, { order: 0 }), punit('a2', 300, { order: 1, selfRating: 'know' })], { order: 0 }),
      pcourse(
        'b',
        [
          punit('b1', 300, { order: 0, optional: true }),
          punit('b2', 300, { order: 1, selfRating: 'somewhat' }),
          punit('b3', 300, { order: 2 }),
        ],
        { order: 1 },
      ),
    ],
    targetDate,
    settings: { bufferPct: 0.12 },
  })

describe('checkFeasibility', () => {
  it('fits with room to spare: no shortfall, and the earliest possible date for reference', () => {
    const f = checkFeasibility(plan('2026-12-31'))
    expect(f.fits).toBe(true)
    expect(f.shortfallMinutes).toBe(0)
    expect(f.options.addTime.extraMinutesPerStudyDay).toBe(0)
    expect(f.options.cutScope.suggestedCut).toEqual([])
    expect(f.options.moveDate.earliestFeasibleDate).toBe('2026-10-27')
  })

  it('does not fit when the work fills every slot up to the target and the buffer is left out', () => {
    const inp = plan('2026-10-23')
    const f = checkFeasibility(inp)
    expect(f.fits).toBe(false)
    expect(f.projectedEnd).toBe('2026-10-23')
    expect(f.bufferedEnd).toBe('2026-10-27')
    // 180 min of buffer, of which only the last evening's 10 spare minutes fall before the target.
    expect(f.shortfallMinutes).toBe(170)
  })

  it('add time: the smallest verified extra minutes per study day', () => {
    const inp = plan('2026-10-23')
    const x = checkFeasibility(inp).options.addTime.extraMinutesPerStudyDay as number
    expect(x).toBe(15)
    expect(checkFeasibility(inp).options.addTime.suggestion).toBe('Add 15 min to each study day')
    const withX = { ...inp, availability: addMinutesToWindows(inp.availability, x) }
    const withLess = { ...inp, availability: addMinutesToWindows(inp.availability, x - 5) }
    expect(planStudy(withX).fits).toBe(true)
    expect(planRun(withLess, null).fits).toBe(false)
  })

  it('move the date: the earliest verified date', () => {
    const inp = plan('2026-10-23')
    const d = checkFeasibility(inp).options.moveDate.earliestFeasibleDate as string
    expect(d).toBe('2026-10-27')
    expect(planStudy({ ...inp, targetDate: d }).fits).toBe(true)
    expect(planStudy({ ...inp, targetDate: addDays(d, -1) }).fits).toBe(false)
  })

  it('cut scope: ranks candidates and suggests a verified smallest-first cut', () => {
    const inp = plan('2026-10-23')
    const f = checkFeasibility(inp)
    expect(f.options.cutScope.candidates.map((c) => [c.unitId, c.reason])).toEqual([
      ['b1', 'optional'],
      ['a2', 'alreadyKnown'],
      ['b2', 'partlyKnown'],
      ['b3', 'lateInPlan'], // later in the plan first
      ['a1', 'lateInPlan'],
    ])
    expect(f.options.cutScope.suggestedCut).toEqual(['b1'])
    expect(f.options.cutScope.cutMinutes).toBe(300)
    expect(planStudy(withoutUnits(inp, ['b1'])).fits).toBe(true)
  })

  it('says so when adding up to 4 h a day is not enough', () => {
    const inp = { ...plan('2026-10-09'), courses: [pcourse('a', [6000])] }
    const f = checkFeasibility(inp)
    expect(f.fits).toBe(false)
    expect(f.options.addTime.extraMinutesPerStudyDay).toBeNull()
    expect(f.options.addTime.suggestion).toBe('Even 4 h more a day is not enough')
    expect(f.options.cutScope.suggestedCut).toEqual([]) // the only unit: cutting everything is not a plan
    expect(f.options.moveDate.earliestFeasibleDate).not.toBeNull()
  })

  it('checks against a given reference date in ASAP mode', () => {
    const f = checkFeasibility(plan(null), '2026-10-23')
    expect(f.fits).toBe(false)
    expect(checkFeasibility(plan(null)).fits).toBe(true)
  })

  it('helpers: candidates skip finished units, durations read naturally', () => {
    expect(cutCandidates([pcourse('a', [0, 50])]).map((c) => c.unitId)).toEqual(['a-u2'])
    expect(formatDuration(15)).toBe('15 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(75)).toBe('1 h 15 min')
  })
})
