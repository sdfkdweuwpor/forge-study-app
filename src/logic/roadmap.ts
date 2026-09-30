/**
 * Roadmap layout (pure): a month scale, and for each goal a lane with its bar (start to projected
 * finish, the extra span past the target apart), course segments packed into rows, assessment markers
 * and weekly milestone ticks. Positions are fractions 0…1 of the visible window, so the screen can draw
 * them with CSS percentages at any width. `today` is injected; nothing here reads the clock.
 */
import type { ID, ISODate } from '@/db/types'
import { addDays, addMonths, diffDays } from './dates'

export type Zoom = 3 | 6 | 12
export const ZOOMS: readonly Zoom[] = [3, 6, 12]

/** Months of history shown before the current one. */
export const LEAD_MONTHS = 1

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export interface MonthCell {
  /** `2026-09`. */
  key: string
  /** "Sep", or "Jan 2027" on the first month and at each new year. */
  label: string
  /** First day of the month. */
  start: ISODate
  days: number
  /** Left edge and width as fractions of the window. */
  x: number
  w: number
}

export interface Scale {
  /** First visible day (the 1st of a month). */
  from: ISODate
  /** The day after the last visible day (the 1st of a month). */
  to: ISODate
  days: number
  months: MonthCell[]
}

const pad = (n: number): string => String(n).padStart(2, '0')

function firstOfMonth(day: ISODate): ISODate {
  return `${day.slice(0, 7)}-01`
}

/**
 * The visible window: `zoom` whole months, starting `LEAD_MONTHS` before the month of `today`, so the
 * present sits near the left with a little history behind it.
 */
export function monthScale(today: ISODate, zoom: Zoom): Scale {
  const from = addMonths(firstOfMonth(today), -LEAD_MONTHS)
  const to = addMonths(from, zoom)
  const days = diffDays(to, from)
  const months: MonthCell[] = []
  for (let i = 0; i < zoom; i++) {
    const start = addMonths(from, i)
    const next = addMonths(from, i + 1)
    const length = diffDays(next, start)
    const newYear = start.slice(5, 7) === '01'
    const name = MONTH_NAMES[Number(start.slice(5, 7)) - 1] ?? ''
    months.push({
      key: start.slice(0, 7),
      label: i === 0 || newYear ? `${name} ${start.slice(0, 4)}` : name,
      start,
      days: length,
      x: diffDays(start, from) / days,
      w: length / days,
    })
  }
  return { from, to, days, months }
}

/** Where a day starts, as a fraction of the window (below 0 or above 1 when outside it). */
export function dayX(scale: Scale, day: ISODate): number {
  return diffDays(day, scale.from) / scale.days
}

export interface Span {
  x0: number
  x1: number
  /** The span starts before / ends after the window and was cut at its edge. */
  clipStart: boolean
  clipEnd: boolean
}

/** A span over the days `start`…`end` (both inclusive), cut to the window; `null` when it is entirely outside. */
export function spanOf(scale: Scale, start: ISODate, end: ISODate): Span | null {
  if (end < start) return null
  const a = dayX(scale, start)
  const b = dayX(scale, addDays(end, 1))
  if (b <= 0 || a >= 1) return null
  return { x0: Math.max(0, a), x1: Math.min(1, b), clipStart: a < 0, clipEnd: b > 1 }
}

/**
 * Packs items into rows so that none overlaps another in the same row (a gap of `minGap` counts as
 * touching). Earliest first, each in the first row that is free; returns the row of each item, in the
 * order given, and how many rows are used.
 */
export function assignRows(
  items: readonly { x0: number; x1: number }[],
  minGap = 0.004,
): { rows: number[]; rowCount: number } {
  const order = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.x0 - b.item.x0 || a.item.x1 - b.item.x1 || a.index - b.index)
  const ends: number[] = []
  const rows: number[] = new Array<number>(items.length).fill(0)
  for (const { item, index } of order) {
    let row = ends.findIndex((end) => end + minGap <= item.x0)
    if (row === -1) {
      row = ends.length
      ends.push(item.x1)
    } else {
      ends[row] = item.x1
    }
    rows[index] = row
  }
  return { rows, rowCount: Math.max(1, ends.length) }
}

// ─── Lanes ──────────────────────────────────────────────────────────────────

export interface RoadmapCourse {
  id: ID
  code: string | null
  title: string
  status: 'todo' | 'active' | 'done'
  /** Planned start and finish (`projectedStart` / `projectedEnd`); a course with either missing is not drawn. */
  start: ISODate | null
  end: ISODate | null
  hours: number
}

export interface RoadmapAssessment {
  id: ID
  kind: 'exam' | 'project' | 'quiz'
  title: string
  date: ISODate | null
  done: boolean
}

export interface RoadmapMilestone {
  id: ID
  title: string
  date: ISODate
}

export interface RoadmapGoal {
  id: ID
  title: string
  icon: string
  startDate: ISODate
  targetDate: ISODate | null
  /** `projection.end`. */
  projectedEnd: ISODate | null
  /** 0…100. */
  percent: number
  courses: readonly RoadmapCourse[]
  assessments: readonly RoadmapAssessment[]
  /** Weekly milestone tasks. */
  weekly: readonly RoadmapMilestone[]
}

export interface PlacedCourse {
  course: RoadmapCourse
  span: Span
  row: number
}

export interface PlacedMarker {
  assessment: RoadmapAssessment
  x: number
}

export interface PlacedTick {
  milestone: RoadmapMilestone
  x: number
}

export interface LaneLayout {
  goalId: ID
  /** The bar from the start to the projected finish, up to the target when the finish is later. */
  bar: Span | null
  /** After the target, up to the projected finish: drawn hatched. `null` when it is not later. */
  overrun: Span | null
  /** The bar's finish: projected end, else the last planned course, else the target. */
  finish: ISODate | null
  /** The target date's position, or `null` with no target or one outside the window. */
  target: number | null
  courses: PlacedCourse[]
  rowCount: number
  markers: PlacedMarker[]
  ticks: PlacedTick[]
  /** Courses planned before / after the window, for a quiet "+2 later" note. */
  before: number
  after: number
}

/** The last planned course day of a goal, or `null`. */
function lastCourseEnd(goal: RoadmapGoal): ISODate | null {
  let last: ISODate | null = null
  for (const c of goal.courses) if (c.end !== null && (last === null || c.end > last)) last = c.end
  return last
}

export function layoutLane(goal: RoadmapGoal, scale: Scale): LaneLayout {
  const finish = goal.projectedEnd ?? lastCourseEnd(goal) ?? goal.targetDate
  const { targetDate } = goal
  const late = finish !== null && targetDate !== null && finish > targetDate
  const solidEnd = finish === null ? null : late && targetDate !== null ? targetDate : finish
  const bar = solidEnd === null ? null : spanOf(scale, goal.startDate, solidEnd)
  const overrun =
    late && targetDate !== null && finish !== null
      ? spanOf(scale, addDays(targetDate, 1), finish)
      : null

  const drawable = goal.courses.filter(
    (c): c is RoadmapCourse & { start: ISODate; end: ISODate } =>
      c.start !== null && c.end !== null,
  )
  const placed = drawable.flatMap((course) => {
    const span = spanOf(scale, course.start, course.end)
    return span ? [{ course, span }] : []
  })
  const before = drawable.filter((c) => c.end < scale.from).length
  const after = drawable.filter((c) => c.start >= scale.to).length
  const { rows, rowCount } = assignRows(placed.map((p) => p.span))

  const inside = (x: number): boolean => x >= 0 && x <= 1
  const markers = goal.assessments.flatMap((assessment) => {
    if (assessment.date === null) return []
    const x = dayX(scale, assessment.date) + 0.5 / scale.days
    return inside(x) ? [{ assessment, x }] : []
  })
  const ticks = goal.weekly.flatMap((milestone) => {
    const x = dayX(scale, milestone.date) + 0.5 / scale.days
    return inside(x) ? [{ milestone, x }] : []
  })
  const targetX = targetDate === null ? null : dayX(scale, targetDate)

  return {
    goalId: goal.id,
    bar,
    overrun,
    finish,
    target: targetX !== null && inside(targetX) ? targetX : null,
    courses: placed.map((p, i) => ({ ...p, row: rows[i] ?? 0 })),
    rowCount,
    markers,
    ticks,
    before,
    after,
  }
}

/** One lane per goal, in the order given. */
export function layoutRoadmap(goals: readonly RoadmapGoal[], scale: Scale): LaneLayout[] {
  return goals.map((goal) => layoutLane(goal, scale))
}
