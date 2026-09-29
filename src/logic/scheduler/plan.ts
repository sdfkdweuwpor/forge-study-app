/**
 * From stored rows to a plan (pure; PLAN §4.3). `rebalanceGoal` reads the rows, calls `planGoal`, and
 * writes what comes back; the wizard can call it with draft rows and no tasks to preview a plan.
 *
 * What the rows mean for the scheduler:
 * - A unit's work is its estimate (`resolveUnitEstimates`), minus its done chunks, minus its pinned
 *   open chunks. A unit or course marked done has none left. A course without units is one synthetic
 *   unit (id = course id, "Study session") sized from the course's hours.
 * - Pinned open chunks stay on their day, use that day's capacity and count toward the end date. A pin
 *   stops holding when its day has passed, when the task is skipped today, or when its unit is done.
 * - Today's finished chunks reserve their minutes today, so finishing one does not pull more work in.
 * - Chunks skipped today reserve their minutes today and may not be placed today again.
 */
import type {
  DateRange,
  Goal,
  GoalProjection,
  ID,
  ISODate,
  Milestone,
  Task,
  Unit,
} from '@/db/types'
import { suggestCatchUp } from './catchUp'
import { mergeDaysOff, resolveOptions } from './capacity'
import { diffSchedule, isActivePin } from './diff'
import {
  computeRemaining,
  resolveUnitEstimates,
  SYNTHETIC_UNIT_TITLE,
  taskMinutes,
  taskUnitId,
  type UnitEstimate,
} from './estimates'
import { buildSchedule } from './schedule'
import type {
  CatchUp,
  PinnedWork,
  SchedCourse,
  ScheduleDiff,
  ScheduleInput,
  ScheduleResult,
  SchedulerIssueCode,
  SchedulerOptions,
} from './types'

export interface GoalRows {
  goal: Pick<Goal, 'id' | 'startDate' | 'targetDate' | 'baselineEnd' | 'availability'>
  /** The goal's courses. */
  milestones: readonly Milestone[]
  /** The goal's units. */
  units: readonly Unit[]
  /** The goal's tasks; only `source: 'schedule'` ones are used. */
  tasks: readonly Task[]
  /** `settings.scheduling.globalDaysOff`. */
  globalDaysOff?: readonly DateRange[]
}

export interface CourseWork {
  courseId: ID
  totalMinutes: number
  doneMinutes: number
  /** `total − done`, pinned open work included. */
  remainingMinutes: number
}

export interface GoalWork {
  totalMinutes: number
  doneMinutes: number
  remainingMinutes: number
  courses: CourseWork[]
}

export interface GoalPlan {
  input: ScheduleInput
  result: ScheduleResult
  catchUp: CatchUp | null
  diff: ScheduleDiff
  /** What `rebalanceGoal` caches on the goal (it adds `computedAt`). */
  projection: Omit<GoalProjection, 'computedAt'>
  /**
   * Projected dates per course with open work. `start` is the earlier of the first planned day and the
   * day its first chunk was finished, so a course in progress keeps the day it began.
   */
  courseDates: Map<ID, { start: ISODate; end: ISODate }>
  work: GoalWork
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

interface CourseUnits {
  course: Milestone
  /** Sorted units, or one synthetic unit for a course without any. */
  units: Array<UnitEstimate & { title: string; order: number }>
}

function courseUnits(
  milestones: readonly Milestone[],
  units: readonly Unit[],
  grain: number,
): CourseUnits[] {
  const byCourse = new Map<ID, Unit[]>()
  for (const u of units) {
    const list = byCourse.get(u.milestoneId) ?? []
    list.push(u)
    byCourse.set(u.milestoneId, list)
  }
  return [...milestones]
    .sort((a, b) => a.order - b.order || cmpStr(a.id, b.id))
    .map((course) => {
      const own = (byCourse.get(course.id) ?? []).sort(
        (a, b) => a.order - b.order || cmpStr(a.id, b.id),
      )
      const courseDone = course.status === 'done'
      if (own.length === 0) {
        const [minutes = 0] = resolveUnitEstimates(course, [{ estimateMinutes: null }], grain)
        return {
          course,
          units: [
            { id: course.id, title: SYNTHETIC_UNIT_TITLE, order: 0, estimateMinutes: minutes, done: courseDone },
          ],
        }
      }
      const minutes = resolveUnitEstimates(course, own, grain)
      return {
        course,
        units: own.map((u, i) => ({
          id: u.id,
          title: u.title,
          order: u.order,
          estimateMinutes: minutes[i] ?? 0,
          done: courseDone || u.status === 'done',
        })),
      }
    })
}

/** Plans a goal from its rows as of `today`. */
export function planGoal(
  rows: GoalRows,
  today: ISODate,
  options: Partial<SchedulerOptions> = {},
): GoalPlan {
  const { grain } = resolveOptions(options)
  const { goal } = rows
  const courses = courseUnits(rows.milestones, rows.units, grain)
  const allUnits = courses.flatMap((c) => c.units)
  const openUnits = new Set(allUnits.filter((u) => !u.done).map((u) => u.id))
  const courseOfUnit = new Map<string, ID>()
  for (const c of courses) for (const u of c.units) courseOfUnit.set(u.id, c.course.id)

  const scheduled = rows.tasks.filter((t) => t.source === 'schedule')
  const done: Task[] = []
  const pinned: Task[] = []
  const pinnedIds = new Set<ID>()
  const reserved: Record<ISODate, number> = {}
  const deferred = new Map<string, number>()
  const reserve = (minutes: number): void => {
    if (minutes > 0) reserved[today] = (reserved[today] ?? 0) + minutes
  }
  for (const t of scheduled) {
    const unit = taskUnitId(t)
    if (t.status === 'done') {
      done.push(t)
      if (t.completedDay === today) reserve(taskMinutes(t))
    } else if (unit !== null && openUnits.has(unit) && isActivePin(t, today)) {
      pinned.push(t)
      pinnedIds.add(t.id)
    } else if (t.skippedOn === today && unit !== null && openUnits.has(unit)) {
      const m = taskMinutes(t)
      reserve(m)
      deferred.set(unit, (deferred.get(unit) ?? 0) + m)
    }
  }

  const remaining = computeRemaining(allUnits, done, pinned, grain)
  const schedCourses: SchedCourse[] = courses.map(({ course, units }) => ({
    id: course.id,
    code: course.code,
    title: course.title,
    order: course.order,
    status: course.status,
    prerequisiteIds: [...course.prerequisiteIds],
    units: units.map((u) => {
      const r = remaining.get(u.id)
      return {
        id: u.id,
        title: u.title,
        order: u.order,
        remainingMinutes: r?.remainingMinutes ?? 0,
        chunkSeqStart: r?.chunkSeqStart ?? 0,
        usedSeqs: r?.usedSeqs ?? [],
        deferredMinutes: deferred.get(u.id) ?? 0,
      }
    }),
  }))

  const pinnedWork: PinnedWork[] = pinned
    .filter((t) => t.dueDate !== null)
    .map((t) => ({
      date: t.dueDate as ISODate,
      minutes: taskMinutes(t),
      courseId: courseOfUnit.get(taskUnitId(t) as string) ?? t.milestoneId ?? '',
    }))
    .sort((a, b) => cmpStr(a.date, b.date) || cmpStr(a.courseId, b.courseId) || a.minutes - b.minutes)

  const input: ScheduleInput = {
    today,
    startDate: goal.startDate,
    targetDate: goal.targetDate,
    baselineEnd: goal.baselineEnd,
    courses: schedCourses,
    availability: mergeDaysOff(goal.availability, rows.globalDaysOff ?? []),
    reservedMinutes: reserved,
    pinned: pinnedWork,
    options,
  }
  const result = buildSchedule(input)
  const catchUp = suggestCatchUp(input, result)
  const diff = diffSchedule(scheduled, result.chunks, { today, pinnedIds })

  const issueCodes: SchedulerIssueCode[] = []
  for (const i of result.issues) if (!issueCodes.includes(i.code)) issueCodes.push(i.code)
  const projection: Omit<GoalProjection, 'computedAt'> = {
    end: result.projectedEnd,
    slipDays: result.slipDays,
    feasible: result.feasible,
    catchUpMinutes: catchUp?.extraMinutesPerStudyDay ?? null,
    requiredMinutesPerStudyDay: catchUp?.requiredMinutesPerStudyDay ?? null,
    issues: issueCodes,
  }

  const firstDone = new Map<ID, ISODate>()
  for (const t of done) {
    const course = courseOfUnit.get(taskUnitId(t) ?? '') ?? t.milestoneId
    if (!course || t.completedDay === null) continue
    const prev = firstDone.get(course)
    if (prev === undefined || t.completedDay < prev) firstDone.set(course, t.completedDay)
  }
  const courseDates = new Map<ID, { start: ISODate; end: ISODate }>()
  for (const w of result.windows) {
    const began = firstDone.get(w.courseId)
    courseDates.set(w.courseId, {
      start: began !== undefined && began < w.start ? began : w.start,
      end: w.end,
    })
  }

  const work: GoalWork = { totalMinutes: 0, doneMinutes: 0, remainingMinutes: 0, courses: [] }
  for (const { course, units } of courses) {
    let total = 0
    let doneMinutes = 0
    for (const u of units) {
      total += u.estimateMinutes
      doneMinutes += u.done
        ? u.estimateMinutes
        : Math.min(u.estimateMinutes, remaining.get(u.id)?.doneMinutes ?? 0)
    }
    work.courses.push({
      courseId: course.id,
      totalMinutes: total,
      doneMinutes,
      remainingMinutes: total - doneMinutes,
    })
    work.totalMinutes += total
    work.doneMinutes += doneMinutes
    work.remainingMinutes += total - doneMinutes
  }

  return { input, result, catchUp, diff, projection, courseDates, work }
}
