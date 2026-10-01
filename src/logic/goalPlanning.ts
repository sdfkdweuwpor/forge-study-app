/**
 * A goal's planning settings and its v1 availability kept in step (pure; schema v2). The minutes-based
 * editors (the wizard's availability step, the schedule dialog, plan import) still write
 * `availability.minutesByWeekday`; the planner reads `planning.weekly`. When the minutes change, each
 * weekday's windows are rebuilt from them, starting where that day's first window started (or at the
 * default study start); when the windows change, the minutes mirror them.
 */
import type {
  Availability,
  Goal,
  GoalPlanning,
  HHmm,
  ISODate,
  TimeWindow,
  WeekMinutes,
} from '@/db/types'
import { planningFromAvailability, V2_DEFAULT_STUDY_START } from './schemaV2'
import { DAY_MINUTES, formatClock, parseClock, windowsToIntervals } from './scheduler/windows'

/** Minutes of study per weekday that the windows add up to (Sunday first). */
export function minutesFromWeekly(weekly: readonly (readonly TimeWindow[])[]): WeekMinutes {
  const out: number[] = []
  for (let d = 0; d < 7; d++) {
    out.push(windowsToIntervals(weekly[d] ?? []).reduce((n, [a, b]) => n + (b - a), 0))
  }
  return out as WeekMinutes
}

/**
 * Windows for new weekday minutes. A day whose minutes did not change keeps its windows exactly; a
 * changed day gets one window of its minutes from where its first window started (else `studyStart`),
 * moved earlier if it would run past midnight; a day with 0 minutes gets none.
 */
export function weeklyFromMinutes(
  minutes: WeekMinutes,
  previous: readonly (readonly TimeWindow[])[],
  studyStart: HHmm = V2_DEFAULT_STUDY_START,
): TimeWindow[][] {
  const before = minutesFromWeekly(previous)
  const fallback = parseClock(studyStart) ?? 9 * 60
  const out: TimeWindow[][] = []
  for (let d = 0; d < 7; d++) {
    const want = Math.max(0, Math.min(DAY_MINUTES, Math.floor(minutes[d] ?? 0)))
    const prev = previous[d] ?? []
    if (want === before[d]) {
      out.push(prev.map((w) => ({ start: w.start, end: w.end })))
      continue
    }
    if (want === 0) {
      out.push([])
      continue
    }
    const first = prev[0] ? parseClock(prev[0].start) : null
    const start = Math.min(first ?? fallback, DAY_MINUTES - want)
    out.push([{ start: formatClock(start), end: formatClock(start + want) }])
  }
  return out
}

/**
 * The planning a goal needs after an edit of its availability or target (what `updateGoal` writes).
 * `asap` is kept: a goal planned at full speed stays so when a target is added.
 */
export function planningForAvailability(
  planning: GoalPlanning | null | undefined,
  availability: Availability,
  targetDate: ISODate | null,
  studyStart: HHmm = V2_DEFAULT_STUDY_START,
): GoalPlanning {
  if (!planning) return planningFromAvailability(availability, targetDate, studyStart)
  return {
    ...planning,
    weekly: weeklyFromMinutes(availability.minutesByWeekday, planning.weekly, studyStart),
  }
}

/** Whether the goal is planned at full speed: asked for, or there is no target to pace to. */
export function isAsap(goal: Pick<Goal, 'planning' | 'targetDate'>): boolean {
  return goal.planning.asap || goal.targetDate === null
}
