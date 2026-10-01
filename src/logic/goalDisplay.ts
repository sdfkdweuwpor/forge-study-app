/**
 * How a goal reads on screen (pure): progress percentages, the projected-finish sentence with its slip,
 * status and course-type labels, and the WGU "CUs completed this term" numbers.
 */
import { format } from 'date-fns'
import type { Goal, GoalProjection, ID, ISODate, Milestone, WguTerm } from '@/db/types'
import { dayOf, diffDays, fromISODate } from './dates'

export type CourseStatus = Milestone['status']

export const COURSE_STATUS_LABELS: Readonly<Record<CourseStatus, string>> = {
  todo: 'Not started',
  active: 'In progress',
  done: 'Done',
}

export const COURSE_TYPE_LABELS: Readonly<Record<NonNullable<Milestone['courseType']>, string>> = {
  OA: 'OA exam',
  PA: 'PA project',
  'OA+PA': 'OA + PA',
}

/** Whole percent, 0…100; 0 when there is nothing to do yet. */
export function percent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
}

/** "1.5", "12", "0.3": hours from minutes with at most one decimal, no trailing ".0". */
export function formatHours(minutes: number): string {
  const h = Math.round((Math.max(0, minutes) / 60) * 10) / 10
  return Number.isInteger(h) ? String(h) : h.toFixed(1)
}

/** "Mar 14", or "Mar 14, 2027" when the year is not `today`'s. */
export function formatDay(day: ISODate, today: ISODate): string {
  const sameYear = day.slice(0, 4) === today.slice(0, 4)
  return format(fromISODate(day), sameYear ? 'MMM d' : 'MMM d, yyyy')
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Calm by design: a slip is never shown as an alarm. Neutral for on time or a small slip, amber for a
 * larger one, green for being ahead. There is no red, and the words describe the date, not the person.
 */
export type FinishTone = 'neutral' | 'success' | 'warning'

export type FinishKind =
  'unscheduled' | 'done' | 'unfinishable' | 'projected' | 'behind' | 'onTrack' | 'ahead'

export interface FinishSummary {
  kind: FinishKind
  tone: FinishTone
  /** The sentence: "Projected Mar 14 · 9 days after target". */
  headline: string
  /** The date on its own, when there is one. */
  end: string | null
  /** "9 days after target", "9 days before target", or null when there is no slip to show. */
  slip: string | null
  /** "Target Jun 30", or null when the goal has no target date. */
  target: string | null
  /** An extra line that helps (never scolds). */
  note: string | null
}

/** A slip up to this many days stays neutral; more is amber. */
export const SLIP_NEUTRAL_DAYS = 7

interface FinishInput {
  projection: GoalProjection | null
  targetDate: ISODate | null
  status: Goal['status']
}

/**
 * The projected finish, in words. `slipDays` is measured by the scheduler against the target date, or
 * the accepted plan's end date when there is no target (DECISIONS: Scheduler).
 */
export function summarizeFinish(goal: FinishInput, today: ISODate): FinishSummary {
  const target = goal.targetDate === null ? null : `Target ${formatDay(goal.targetDate, today)}`
  const base = { end: null, slip: null, target, note: null }
  if (goal.status === 'done') {
    return { ...base, kind: 'done', tone: 'success', headline: 'Completed' }
  }
  const p = goal.projection
  if (p === null) {
    return { ...base, kind: 'unscheduled', tone: 'neutral', headline: 'Not scheduled yet' }
  }
  if (p.end === null) {
    if (p.issues.includes('NO_AVAILABILITY')) {
      return {
        ...base,
        kind: 'unfinishable',
        tone: 'neutral',
        headline: 'No finish date yet',
        note: 'Add some study days in the schedule settings to plan this goal.',
      }
    }
    if (p.issues.includes('HORIZON_EXCEEDED')) {
      return {
        ...base,
        kind: 'unfinishable',
        tone: 'warning',
        headline: 'Finishing is more than three years out',
        note: 'More study time, or fewer hours in the courses, would bring it closer.',
      }
    }
    return { ...base, kind: 'done', tone: 'success', headline: 'Nothing left to schedule' }
  }
  const end = formatDay(p.end, today)
  const slip = p.slipDays
  if (slip === null) {
    return { ...base, kind: 'projected', tone: 'neutral', headline: `Projected ${end}`, end }
  }
  const against = goal.targetDate === null ? 'your plan' : 'target'
  if (slip > 0) {
    const label = `${plural(slip, 'day')} after ${against}`
    return {
      ...base,
      kind: 'behind',
      tone: slip > SLIP_NEUTRAL_DAYS ? 'warning' : 'neutral',
      headline: `Projected ${end} · ${label}`,
      end,
      slip: label,
    }
  }
  if (slip === 0) {
    return {
      ...base,
      kind: 'onTrack',
      tone: 'success',
      headline: `On track · finishing ${end}`,
      end,
    }
  }
  const label = `${plural(-slip, 'day')} before ${against}`
  return {
    ...base,
    kind: 'ahead',
    tone: 'success',
    headline: `Projected ${end} · ${label}`,
    end,
    slip: label,
  }
}

// ─── WGU term ───────────────────────────────────────────────────────────────

/** The term to show: the one containing `today`, else the latest that has started, else the first. */
export function currentTerm(terms: readonly WguTerm[], today: ISODate): WguTerm | null {
  if (terms.length === 0) return null
  const sorted = [...terms].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const inside = sorted.find((t) => t.start <= today && today <= t.end)
  if (inside) return inside
  const started = sorted.filter((t) => t.start <= today)
  return started[started.length - 1] ?? sorted[0] ?? null
}

type TermCourse = Pick<
  Milestone,
  'id' | 'status' | 'cus' | 'termId' | 'projectedEnd' | 'completedAt'
>

export interface TermProgress {
  term: WguTerm
  /** CUs of the term's courses that are done. */
  done: number
  /** CUs of every course planned for the term (done or not). */
  total: number
  /** Courses that count toward the term, and how many of them are done. */
  courses: number
  coursesDone: number
  /** Days left in the term, negative once it is over. */
  daysLeft: number
}

/**
 * "CUs completed this term". A course belongs to the term when it is assigned to it (`termId`), or,
 * with no assignment, when it was finished or is projected to finish inside the term's dates.
 * Courses without CUs count as 0, so they do not move the bar.
 */
export function termProgress(
  terms: readonly WguTerm[],
  courses: readonly TermCourse[],
  today: ISODate,
): TermProgress | null {
  const term = currentTerm(terms, today)
  if (term === null) return null
  const inside = (day: ISODate | null): boolean =>
    day !== null && day >= term.start && day <= term.end
  let done = 0
  let total = 0
  let count = 0
  let countDone = 0
  const seen = new Set<ID>()
  for (const c of courses) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    const finishedOn = c.completedAt === null ? null : dayOf(c.completedAt)
    const member =
      c.termId === term.id ||
      (c.termId === null &&
        inside(c.status === 'done' ? (finishedOn ?? c.projectedEnd) : c.projectedEnd))
    if (!member) continue
    count++
    total += c.cus ?? 0
    if (c.status === 'done') {
      countDone++
      done += c.cus ?? 0
    }
  }
  return {
    term,
    done,
    total,
    courses: count,
    coursesDone: countDone,
    daysLeft: diffDays(term.end, today),
  }
}

/** Courses in list order: `order`, then age, then id (a stable tiebreak). */
export function sortCourses<T extends Pick<Milestone, 'id' | 'order' | 'createdAt'>>(
  courses: readonly T[],
): T[] {
  return [...courses].sort(
    (a, b) =>
      a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** "C182 Introduction to IT", or just the title for a course with no code. */
export function courseLabel(course: Pick<Milestone, 'code' | 'title'>): string {
  return [course.code, course.title].filter((s) => s !== null && s !== '').join(' ')
}
