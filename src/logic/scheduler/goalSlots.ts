/**
 * From stored rows to a slot-level plan (pure; PLAN §4.6, schema v2). `rebalanceGoal` reads the rows,
 * calls `planGoalSlots`, and writes what comes back; the wizard calls it with draft rows and no tasks to
 * preview a plan; the daily run uses its `live` input for `rollForward`.
 *
 * What the rows mean for the planner:
 * - Availability: `goal.planning` (weekly windows or a shift cycle, session length) with the goal's days
 *   off and the global ones as blackouts. The pace is the target's unless the goal is ASAP.
 * - A unit's work is its estimate (`resolveUnitEstimates`) minus its done study sessions, minus its
 *   pinned open ones; a unit or course marked done has none left. Readiness rows add extra review
 *   minutes (the hook in `readinessPlan`).
 * - Planned assessments become the planner's assessments; one whose status is not `planned`, whose
 *   assessment item was checked off, or whose course is finished, is done.
 * - Pinned open items keep their slots. A pin lapses when its day has passed, when it is skipped today,
 *   or when its unit is done.
 * - Time that is taken is never planned over: other tasks with a do time (everyday tasks, other goals'
 *   sessions) and the slots of this goal's items finished today. Items skipped today take their length
 *   off the end of today, so a skipped session moves on instead of coming straight back.
 */
import type {
  DateRange,
  Goal,
  GoalProjection,
  ID,
  ISODate,
  Milestone,
  PlannedAssessment,
  Readiness,
  Task,
  Unit,
} from '@/db/types'
import { addDays, diffDays } from '../dates'
import { isAsap } from '../goalPlanning'
import { extraReviewMinutesFrom } from '../readinessPlan'
import { isActivePin } from './diff'
import { computeRemaining, taskMinutes, taskUnitId } from './estimates'
import { findExtraMinutes } from './feasibility'
import { courseUnits, goalWork, isStudyTask, type GoalWork } from './plan'
import { planStudy } from './planner'
import type {
  AvailabilityV2,
  BusyBlock,
  DayWindows,
  LivePlanInput,
  PinnedPlanItem,
  PlannerAssessment,
  PlannerCourse,
  PlannerInput,
  PlannerResult,
  WeekWindows,
} from './plannerTypes'
import { currentPlanItems, diffPlanTasks, isPlanTask, type PlanTaskDiff } from './planTasks'
import type { CatchUp } from './types'
import { averageStudyDayMinutes, capacityForDate, formatClock, parseClock } from './windows'

export interface SlotGoalRows {
  goal: Pick<Goal, 'id' | 'startDate' | 'targetDate' | 'baselineEnd' | 'availability' | 'planning'>
  milestones: readonly Milestone[]
  units: readonly Unit[]
  /** The goal's tasks; its plan items are the `source: 'schedule'` ones with a key. */
  tasks: readonly Task[]
  plannedAssessments?: readonly PlannedAssessment[]
  readiness?: readonly Readiness[]
  /** `settings.scheduling.globalDaysOff`. */
  globalDaysOff?: readonly DateRange[]
  /**
   * Tasks outside this goal's plan that hold a slot (a do time on or after today): never planned over.
   * Rows of this goal's plan and finished tasks are ignored if passed.
   */
  busy?: readonly Task[]
  weekStartsOn?: 0 | 1
}

export interface SlotPlan {
  input: PlannerInput
  result: PlannerResult
  /** Set when the plan misses its target (or, without one, slips past the accepted end). */
  catchUp: CatchUp | null
  diff: PlanTaskDiff
  /** What `rebalanceGoal` caches on the goal (it adds `computedAt`). */
  projection: Omit<GoalProjection, 'computedAt'>
  /** Per course with open work: the first day (or the day it was begun) and the last. */
  courseDates: Map<ID, { start: ISODate; end: ISODate }>
  work: GoalWork
  /** The stored plan as a live plan, for `rollForward` / `replanWeek`. */
  live: LivePlanInput
}

const GRAIN = 5
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** The goal's availability for the planner: its windows, with its and the global days off. */
export function goalAvailability(
  goal: Pick<Goal, 'availability' | 'planning'>,
  globalDaysOff: readonly DateRange[] = [],
): AvailabilityV2 {
  const p = goal.planning
  const weekly = Array.from({ length: 7 }, (_, d): DayWindows =>
    (p.weekly[d] ?? []).map((w) => ({ start: w.start, end: w.end })),
  ) as unknown as WeekWindows
  return {
    weekly,
    sessionMinutes: p.sessionMinutes,
    blackouts: [...goal.availability.daysOff, ...globalDaysOff],
    shiftPattern: p.shiftPattern
      ? {
          anchor: p.shiftPattern.anchor,
          cycle: p.shiftPattern.cycle.map((w) => (w ? w.map((x) => ({ ...x })) : null)),
        }
      : null,
  }
}

/** A task's slot as busy time (`null` when it has none). */
function blockOf(t: Task, date: ISODate, av: AvailabilityV2): BusyBlock | null {
  const minutes = t.durationMinutes ?? (taskMinutes(t) || 25)
  if (minutes <= 0) return null
  const start =
    t.doDate === date && t.doTime !== null ? t.doTime : capacityForDate(av, date)[0]?.start
  if (start === undefined) return null
  return { date, start, durationMinutes: minutes, source: 'task', id: t.id }
}

/** The planner input for a goal, and what the caller needs to reconcile the result with its tasks. */
export interface GoalInput {
  input: PlannerInput
  /** Open plan tasks that keep their slot. */
  pinnedIds: ReadonlySet<ID>
  /** The goal's plan tasks (v1 chunks and v2 items). */
  planTasks: Task[]
  doneStudy: Task[]
  courseOfUnit: ReadonlyMap<string, ID>
  asap: boolean
}

/** The planner input for a goal's rows as of `today` (see the file comment). */
export function goalPlannerInput(rows: SlotGoalRows, today: ISODate): GoalInput {
  const { goal } = rows
  const av = goalAvailability(goal, rows.globalDaysOff ?? [])
  const courses = courseUnits(rows.milestones, rows.units, GRAIN)
  const unitRows = new Map(rows.units.map((u) => [u.id, u]))
  const openUnits = new Set(courses.flatMap((c) => c.units.filter((u) => !u.done).map((u) => u.id)))
  const courseOfUnit = new Map<string, ID>()
  for (const c of courses) for (const u of c.units) courseOfUnit.set(u.id, c.course.id)

  const planTasks = rows.tasks.filter(isPlanTask)
  const doneStudy: Task[] = []
  const pinnedStudy: Task[] = []
  const pinnedIds = new Set<ID>()
  const pinned: PinnedPlanItem[] = []
  const completedKeys: string[] = []
  const blocked: BusyBlock[] = []
  const skipped: Task[] = []

  for (const t of planTasks) {
    const key = t.scheduleKey as string
    if (t.status === 'done') {
      completedKeys.push(key)
      if (isStudyTask(t)) doneStudy.push(t)
      // Finished today: its time was used, so the rest of today stays as planned.
      if (t.completedDay === today) {
        const b = blockOf(t, today, av)
        if (b) blocked.push(b)
      }
      continue
    }
    const unit = t.kind === 'study' ? taskUnitId(t) : null
    const unitOpen = unit === null || openUnits.has(unit)
    if (unitOpen && isActivePin(t, today) && t.doDate !== null && t.kind !== 'milestone') {
      pinnedIds.add(t.id)
      if (t.kind === 'study') pinnedStudy.push(t)
      const minutes = t.durationMinutes ?? taskMinutes(t)
      pinned.push({
        key,
        kind: t.kind === 'task' ? 'study' : t.kind,
        courseId: t.milestoneId ?? (unit !== null ? (courseOfUnit.get(unit) ?? null) : null),
        date: t.doDate,
        startTime: t.doTime,
        durationMinutes: minutes,
      })
    } else if (t.skippedOn === today) {
      skipped.push(t)
    }
  }
  // Skipped today: the day gives up that much time at its end (stacked back from the last window's
  // end), so the session moves on and today holds one session less. Where it sat does not matter, so
  // the next run (after it moved to a later day) reserves exactly the same time.
  const lastEnd = capacityForDate(av, today).reduce<number | null>((m, w) => {
    const e = parseClock(w.end)
    return e !== null && (m === null || e > m) ? e : m
  }, null)
  if (lastEnd !== null) {
    let cursor = lastEnd
    for (const t of skipped.sort((a, b) => cmpStr(a.id, b.id))) {
      const minutes = t.durationMinutes ?? (taskMinutes(t) || 25)
      const start = Math.max(0, cursor - minutes)
      if (cursor - start <= 0) break
      blocked.push({
        date: today,
        start: formatClock(start),
        durationMinutes: cursor - start,
        source: 'task',
        id: t.id,
      })
      cursor = start
    }
  }
  for (const t of rows.busy ?? []) {
    if (t.status === 'done' || t.doDate === null || t.doTime === null || t.doDate < today) continue
    if (t.goalId === goal.id && isPlanTask(t)) continue
    const b = blockOf(t, t.doDate, av)
    if (b) blocked.push(b)
  }
  blocked.sort(
    (a, b) => cmpStr(a.date, b.date) || cmpStr(a.start, b.start) || cmpStr(a.id ?? '', b.id ?? ''),
  )
  pinned.sort((a, b) => cmpStr(a.date, b.date) || cmpStr(a.key, b.key))
  completedKeys.sort(cmpStr)

  const remaining = computeRemaining(
    courses.flatMap((c) => c.units),
    doneStudy,
    pinnedStudy,
    GRAIN,
  )
  const extra = extraReviewMinutesFrom(rows.readiness ?? [])
  const plannerCourses: PlannerCourse[] = courses.map(({ course, units }) => ({
    id: course.id,
    code: course.code,
    title: course.title,
    order: course.order,
    status: course.status,
    prerequisiteIds: [...course.prerequisiteIds],
    ...(extra.courses.has(course.id) ? { extraReviewMinutes: extra.courses.get(course.id) } : {}),
    units: units.map((u) => {
      const r = remaining.get(u.id)
      const row = unitRows.get(u.id)
      const rating = row ? row.selfRating : course.selfRating
      return {
        id: u.id,
        title: u.title,
        order: u.order,
        remainingMinutes: r?.remainingMinutes ?? 0,
        usedSeqs: r?.usedSeqs ?? [],
        ...(rating ? { selfRating: rating } : {}),
        ...(row?.optional ? { optional: true } : {}),
        ...(extra.units.has(u.id) && !u.done ? { extraReviewMinutes: extra.units.get(u.id) } : {}),
      }
    }),
  }))

  const doneCourses = new Set(rows.milestones.filter((m) => m.status === 'done').map((m) => m.id))
  const doneAssessments = new Set(
    planTasks
      .filter((t) => t.kind === 'assessment' && t.status === 'done' && t.assessmentId !== null)
      .map((t) => t.assessmentId as ID),
  )
  const assessments: PlannerAssessment[] = [...(rows.plannedAssessments ?? [])]
    .sort((a, b) => a.order - b.order || cmpStr(a.id, b.id))
    .map((a) => ({
      id: a.id,
      courseId: a.milestoneId,
      kind: a.kind,
      title: a.title,
      date: a.date,
      time: a.time,
      ...(a.durationMinutes !== null ? { durationMinutes: a.durationMinutes } : {}),
      // Checked off, or its course is finished (a finished course needs no exam).
      done:
        a.status !== 'planned' ||
        doneAssessments.has(a.id) ||
        (a.milestoneId !== null && doneCourses.has(a.milestoneId)),
    }))

  const asap = isAsap({ planning: goal.planning, targetDate: goal.targetDate })
  const input: PlannerInput = {
    today,
    startDate: goal.startDate,
    targetDate: asap ? null : goal.targetDate,
    baselineEnd: goal.baselineEnd,
    availability: av,
    courses: plannerCourses,
    assessments,
    pinned,
    blockedSlots: blocked,
    completedKeys,
    settings: { bufferPct: goal.planning.bufferPct, weekStartsOn: rows.weekStartsOn ?? 1 },
  }
  return { input, pinnedIds, planTasks, doneStudy, courseOfUnit, asap }
}

/**
 * The stored plan as a live plan for `rollForward` / `replanWeek`, without running the planner unless
 * the goal has no accepted pace yet (then the pace a fresh plan would choose).
 */
export function goalLivePlan(
  rows: SlotGoalRows,
  today: ISODate,
): GoalInput & { live: LivePlanInput } {
  const g = goalPlannerInput(rows, today)
  const stored = rows.goal.planning.paceMinutesPerStudyDay
  const pace = g.asap ? null : (stored ?? planStudy(g.input).pace.minutesPerStudyDay)
  return {
    ...g,
    live: {
      ...g.input,
      current: currentPlanItems(rows.tasks, today),
      paceMinutesPerStudyDay: pace,
    },
  }
}

/** Plans a goal from its rows as of `today`. Equal rows give deep-equal plans. */
export function planGoalSlots(rows: SlotGoalRows, today: ISODate): SlotPlan {
  const { goal } = rows
  const { input, pinnedIds, planTasks, doneStudy, courseOfUnit, asap } = goalPlannerInput(
    rows,
    today,
  )
  const result = planStudy(input)

  // Projection: the finish, measured against the target (else the accepted end).
  const end = result.projectedEnd
  const reference = goal.targetDate ?? goal.baselineEnd
  const slipDays = end !== null && reference !== null ? diffDays(end, reference) : null
  const bufferedEnd = result.buffer.bufferedEnd ?? end
  const feasible =
    result.fits &&
    (goal.targetDate === null || bufferedEnd === null || bufferedEnd <= goal.targetDate)
  const late = !feasible || (goal.targetDate === null && slipDays !== null && slipDays > 0)
  const catchUp =
    late && reference !== null
      ? catchUpFor(input, input.availability, reference, today, result)
      : null
  const issueCodes: string[] = []
  for (const i of result.issues) if (!issueCodes.includes(i.code)) issueCodes.push(i.code)
  const projection: Omit<GoalProjection, 'computedAt'> = {
    end,
    slipDays,
    feasible,
    catchUpMinutes: catchUp?.extraMinutesPerStudyDay ?? null,
    requiredMinutesPerStudyDay: catchUp?.requiredMinutesPerStudyDay ?? null,
    issues: issueCodes,
  }

  // Course dates: a course in progress keeps the day it began.
  const firstDone = new Map<ID, ISODate>()
  for (const t of doneStudy) {
    const course = courseOfUnit.get(taskUnitId(t) ?? '') ?? t.milestoneId
    if (!course || t.completedDay === null) continue
    const prev = firstDone.get(course)
    if (prev === undefined || t.completedDay < prev) firstDone.set(course, t.completedDay)
  }
  const courseDates = new Map<ID, { start: ISODate; end: ISODate }>()
  for (const w of result.courseWindows) {
    const began = firstDone.get(w.courseId)
    courseDates.set(w.courseId, {
      start: began !== undefined && began < w.start ? began : w.start,
      end: w.end,
    })
  }

  const diff = diffPlanTasks(planTasks, result.items, { today, pinnedIds })
  const live: LivePlanInput = {
    ...input,
    current: currentPlanItems(rows.tasks, today),
    paceMinutesPerStudyDay: asap
      ? null
      : (goal.planning.paceMinutesPerStudyDay ?? result.pace.minutesPerStudyDay),
  }
  return {
    input,
    result,
    catchUp,
    diff,
    projection,
    courseDates,
    work: goalWork({ milestones: rows.milestones, units: rows.units, tasks: rows.tasks }),
    live,
  }
}

/** Study days in `[from, to]` with study time. */
function studyDaysBetween(av: AvailabilityV2, from: ISODate, to: ISODate): number {
  let n = 0
  for (let d = from, i = 0; d <= to && i < 3660; d = addDays(d, 1), i++)
    if (capacityForDate(av, d).length > 0) n++
  return n
}

/**
 * "Add X min to every study day" for a plan that misses `reference`: the smallest verified X (up to
 * 4 h), and what a study day would then hold.
 */
function catchUpFor(
  input: PlannerInput,
  av: AvailabilityV2,
  reference: ISODate,
  today: ISODate,
  result: PlannerResult,
): CatchUp {
  const start = input.startDate && input.startDate > today ? input.startDate : today
  const studyDaysLeft = reference < start ? 0 : studyDaysBetween(av, start, reference)
  const extra = studyDaysLeft > 0 ? findExtraMinutes(input, reference) : null
  return {
    extraMinutesPerStudyDay: extra,
    requiredMinutesPerStudyDay:
      extra === null ? null : Math.round(averageStudyDayMinutes(av) / GRAIN) * GRAIN + extra,
    studyDaysLeft,
    suggestedTargetDate: result.buffer.bufferedEnd ?? result.projectedEnd,
  }
}
