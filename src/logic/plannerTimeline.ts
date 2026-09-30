/**
 * The compact timeline of the plan preview (pure): where each course's bar, each assessment, the target and
 * the projected finish sit along the calendar, as fractions of the axis (0 = first day, 1 = last day).
 * The component only turns fractions into pixels.
 */
import type { ISODate } from '@/db/types'
import { addDays, diffDays, fromISODate } from './dates'
import { shortDate } from './scheduler/milestones'

export interface TimelineCourseIn {
  id: string
  label: string
  start: ISODate
  end: ISODate
}

export interface TimelineAssessmentIn {
  id: string
  courseId: string | null
  title: string
  kind: 'exam' | 'project' | 'quiz'
  date: ISODate
}

export interface TimelineInput {
  start: ISODate
  courses: readonly TimelineCourseIn[]
  assessments: readonly TimelineAssessmentIn[]
  target: ISODate | null
  projectedEnd: ISODate | null
}

export interface TimelineTick {
  x: number
  label: string
  /** January (or the first tick) also names the year. */
  major: boolean
}

export interface TimelineBar {
  id: string
  label: string
  x0: number
  x1: number
  marks: Array<{ id: string; x: number; kind: 'exam' | 'project' | 'quiz'; title: string; date: ISODate }>
}

export interface TimelineModel {
  from: ISODate
  to: ISODate
  ticks: TimelineTick[]
  bars: TimelineBar[]
  target: number | null
  finish: number | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Month starts inside `[from, to]` as ticks. */
function monthTicks(from: ISODate, to: ISODate, x: (d: ISODate) => number): TimelineTick[] {
  const ticks: TimelineTick[] = []
  const first = fromISODate(from)
  let year = first.getFullYear()
  let month = first.getMonth()
  for (let i = 0; i < 60; i++) {
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
    const day: ISODate = `${year}-${String(month + 1).padStart(2, '0')}-01`
    if (day > to) break
    ticks.push({ x: x(day), label: MONTHS[month] ?? '', major: month === 0 })
  }
  return ticks
}

/** The timeline's geometry, or `null` when there is nothing to draw. */
export function timelineModel(input: TimelineInput): TimelineModel | null {
  const dates = [
    input.start,
    input.target,
    input.projectedEnd,
    ...input.courses.flatMap((c) => [c.start, c.end]),
    ...input.assessments.map((a) => a.date),
  ].filter((d): d is ISODate => d !== null)
  if (input.courses.length === 0 || dates.length === 0) return null
  const from = input.start
  const last = dates.reduce((m, d) => (d > m ? d : m), from)
  // A little air after the last mark.
  const to = addDays(last, Math.max(3, Math.round(diffDays(last, from) * 0.03)))
  const span = Math.max(1, diffDays(to, from))
  const x = (d: ISODate): number => Math.min(1, Math.max(0, diffDays(d, from) / span))

  const bars = input.courses.map((c): TimelineBar => ({
    id: c.id,
    label: c.label,
    x0: x(c.start),
    // A one-day course still shows.
    x1: Math.max(x(c.end), x(c.start) + 1 / span),
    marks: input.assessments
      .filter((a) => a.courseId === c.id)
      .map((a) => ({ id: a.id, x: x(a.date), kind: a.kind, title: a.title, date: a.date })),
  }))
  return {
    from,
    to,
    ticks: monthTicks(from, to, x),
    bars,
    target: input.target === null ? null : x(input.target),
    finish: input.projectedEnd === null ? null : x(input.projectedEnd),
  }
}

/** A sentence for screen readers. */
export function timelineSummary(m: TimelineModel): string {
  return `Timeline of ${m.bars.length} ${m.bars.length === 1 ? 'course' : 'courses'} from ${shortDate(m.from)} to ${shortDate(m.to)}`
}
