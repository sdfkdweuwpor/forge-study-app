/**
 * Catch-up suggestions (PLAN §4.2 step 5). Every number is verified by re-running the walk, never
 * estimated: chunk sizes and day boundaries make "more minutes" and "on time" not strictly monotonic,
 * so the searches are linear in grain steps.
 *
 * The reference date is `targetDate`, or the accepted plan's `baselineEnd` when there is no target:
 * the same date the slip ("+9 days") is measured against.
 */
import {
  countStudyDays,
  dayNumber,
  floorTo,
  MAX_REQUIRED_MINUTES,
} from './capacity'
import { finishSchedule, prepareSchedule, walkSchedule, type PreparedSchedule } from './schedule'
import type { CatchUp, ScheduleInput, ScheduleResult } from './types'

/** Whether the plan fits by `ref` with weekday capacities `caps`. */
function fitsBy(p: PreparedSchedule, caps: readonly number[], ref: number): boolean {
  if (p.pinnedEnd !== null && p.pinnedEnd > ref) return false
  return walkSchedule(p, caps, ref).unscheduled === 0
}

/**
 * How to get back on time, or `null` when the plan already is (or there is no date to be on time
 * for, or nothing left to place).
 * - `extraMinutesPerStudyDay`: smallest X (grain steps up to `maxCatchUp`) such that adding X to every
 *   weekday that has study time (`addMinutesToStudyDays`) finishes by the reference date.
 * - `requiredMinutesPerStudyDay`: smallest uniform minutes per study weekday that finishes by the
 *   reference date, starting from `ceil(remaining / studyDaysLeft)`; capped at 960, `null` when no
 *   study days are left (the UI then asks for more study days).
 */
export function suggestCatchUp(input: ScheduleInput, result?: ScheduleResult): CatchUp | null {
  const refIso = input.targetDate ?? input.baselineEnd
  if (refIso === null) return null
  const p = prepareSchedule(input)
  if (p.totalMinutes === 0) return null
  const res = result ?? finishSchedule(p, walkSchedule(p, p.caps))
  const ref = dayNumber(refIso)
  const blocked = res.issues.some((i) => i.code === 'NO_AVAILABILITY' || i.code === 'HORIZON_EXCEEDED')
  if (!blocked && res.projectedEnd !== null && dayNumber(res.projectedEnd) <= ref) return null

  const { grain, maxCatchUp } = p.opts
  const raw = input.availability.minutesByWeekday
  const studyDaysLeft = ref >= p.start ? countStudyDays(p.start, ref, p.caps, p.off) : 0

  let extra: number | null = null
  if (ref >= p.start && raw.some((m) => m > 0)) {
    for (let x = grain; x <= maxCatchUp; x += grain) {
      const caps = raw.map((m) => (m > 0 ? floorTo(m + x, grain) : 0))
      if (fitsBy(p, caps, ref)) {
        extra = x
        break
      }
    }
  }

  let required: number | null = null
  if (studyDaysLeft > 0) {
    const first = Math.max(grain, Math.ceil(Math.ceil(p.totalMinutes / studyDaysLeft) / grain) * grain)
    for (let r = first; r <= MAX_REQUIRED_MINUTES; r += grain) {
      const caps = p.caps.map((c) => (c > 0 ? r : 0))
      if (fitsBy(p, caps, ref)) {
        required = r
        break
      }
    }
  }

  return {
    extraMinutesPerStudyDay: extra,
    requiredMinutesPerStudyDay: required,
    studyDaysLeft,
    suggestedTargetDate: res.projectedEnd,
  }
}
