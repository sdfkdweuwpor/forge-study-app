/**
 * Goal Breakdown Planner contract (PLAN §4.5). The planner places session-sized work into concrete time
 * slots (`doDate` + `startTime` + `durationMinutes`) inside the user's study windows. It sits beside the
 * day-level scheduler (`buildSchedule`), which stays as it is for v1 goals.
 *
 * Plain data in, plain data out; `today` (and optionally `now`) is injected. Times are wall-clock
 * `'HH:mm'` on local calendar days.
 */
import type {
  DateRange,
  HHmm,
  ISODate,
  Millis,
  PlanItemKind,
  SelfRating,
  TimeWindow,
} from '@/db/types'
import type { CourseStatus, CourseWindow, SchedulerIssue } from './types'

// ─── Availability v2 ────────────────────────────────────────────────────────

/** A study window on one day (`@/db/types`). Overnight = two windows. */
export type { PlanItemKind, SelfRating, TimeWindow }
export type DayWindows = readonly TimeWindow[]
/** Index 0 = Sunday … 6 = Saturday. */
export type WeekWindows = readonly [
  DayWindows,
  DayWindows,
  DayWindows,
  DayWindows,
  DayWindows,
  DayWindows,
  DayWindows,
]

/**
 * A rotating shift pattern: day `anchor` is cycle day 0, the next day cycle day 1, and so on, wrapping
 * after `cycle.length` days (in both directions). `null` = no study that day. When set it replaces the
 * weekday windows; blackouts still apply.
 */
export interface ShiftPattern {
  anchor: ISODate
  cycle: ReadonlyArray<DayWindows | null>
}

export interface AvailabilityV2 {
  weekly: WeekWindows
  /** Target study-session length, 25–90 min. */
  sessionMinutes: number
  /** Inclusive date ranges with no study (vacations, the goal's and the global days off). */
  blackouts: readonly DateRange[]
  shiftPattern?: ShiftPattern | null
}

/**
 * Time that is taken: an everyday task with a do time, a calendar event (the calendar-sync hook), or
 * any other fixed commitment. May run past midnight.
 */
export interface BusyBlock {
  date: ISODate
  start: HHmm
  durationMinutes: number
  source?: 'task' | 'calendar' | 'other'
  id?: string
}

// ─── Work ───────────────────────────────────────────────────────────────────

export type AssessmentKind = 'exam' | 'project' | 'quiz'

export interface PlannerUnit {
  id: string
  title: string
  order: number
  /** Study minutes still to place (after done and pinned sessions). ≤ 0 = nothing left. */
  remainingMinutes: number
  /** Session numbers held by done or pinned sessions; new ones take the smallest free numbers. */
  usedSeqs?: readonly number[]
  /** Readiness hook: extra review minutes, placed right after this unit's study sessions. */
  extraReviewMinutes?: number
  /** Used by `checkFeasibility` to rank what could be cut. */
  selfRating?: SelfRating
  optional?: boolean
}

export interface PlannerCourse {
  id: string
  code: string | null
  title: string
  order: number
  status: CourseStatus
  prerequisiteIds: readonly string[]
  /** All units, done ones included (they number the units in milestone titles). */
  units: readonly PlannerUnit[]
  /** Readiness hook: extra review minutes, placed after the course's last unit. */
  extraReviewMinutes?: number
}

export interface PlannerAssessment {
  id: string
  /** `null` = the goal as a whole (after every course). */
  courseId: string | null
  kind: AssessmentKind
  title: string
  /** `null` = placed on the first study day after its course's work. */
  date: ISODate | null
  /** With a date: a booked time; the assessment then blocks its slot. */
  time?: HHmm | null
  durationMinutes?: number
  done?: boolean
}

/** An open item the user pinned: it keeps its slot, uses it, and counts toward the end date. */
export interface PinnedPlanItem {
  key: string
  kind: PlanItemKind
  courseId: string | null
  date: ISODate
  /** `null` = pinned to the day only; the planner gives it the day's first free slot. */
  startTime: HHmm | null
  durationMinutes: number
}

export interface PlannerSettings {
  /** Share of the planned work reserved as slack after the last session (0.10–0.15 in the UI). */
  bufferPct: number
  /** Gap after each study session before the next one on the same day. */
  breakMinutes: number
  minSessionMinutes: number
  maxSessionMinutes: number
  grain: number
  horizonDays: number
  reviewMinutes: number
  practiceTestMinutes: number
  /** Study days before an exam for its practice test (2–4). */
  practiceOffset: number
  /** Study days before an assessment for its spaced reviews, per kind, farthest first. */
  reviewOffsets: Readonly<Record<AssessmentKind, readonly number[]>>
  /** Length of an assessment with a booked time and no duration of its own. */
  assessmentMinutes: Readonly<Record<AssessmentKind, number>>
  weekStartsOn: 0 | 1
}

export interface PlannerInput {
  today: ISODate
  /** When set and on `today`, today's time before it is not used. */
  now?: Millis | null
  /** Default `today`; the walk starts at the later of the two. */
  startDate?: ISODate
  /** `null` = as fast as possible. */
  targetDate: ISODate | null
  /** The accepted plan's end; slip is measured against it when there is no target. */
  baselineEnd?: ISODate | null
  availability: AvailabilityV2
  courses: readonly PlannerCourse[]
  assessments?: readonly PlannerAssessment[]
  pinned?: readonly PinnedPlanItem[]
  /** Calendar-sync hook and everyday tasks with a do time: never overlapped. */
  blockedSlots?: readonly BusyBlock[]
  /** Keys of generated items already done (a practice test taken): not generated again. */
  completedKeys?: readonly string[]
  settings?: Partial<PlannerSettings>
}

// ─── Output ─────────────────────────────────────────────────────────────────

export interface PlanItem {
  /**
   * Stable across re-plans: study `${unitId}:${seq}`, readiness review `extra:${unitOrCourseId}:${n}`,
   * spaced review `review:${assessmentId}:${n}`, `practice:${assessmentId}`,
   * `assessment:${assessmentId}`, `milestone:${weekStart}`.
   */
  key: string
  kind: PlanItemKind
  title: string
  courseId: string | null
  unitId: string | null
  assessmentId: string | null
  doDate: ISODate
  /** `null` for day markers: milestones and assessments without a booked slot. */
  startTime: HHmm | null
  /** 0 for markers. */
  durationMinutes: number
  /** Hard deadline: the assessment date for its reviews and practice test, the target for a milestone. */
  dueDate: ISODate | null
  seq: number | null
  seqTotal: number | null
}

export type PlannerIssue =
  | SchedulerIssue
  /** Study for the assessment's course is still planned on or after its date. */
  | { code: 'ASSESSMENT_TOO_EARLY'; assessmentId: string; lastStudyDate: ISODate }
  | { code: 'ASSESSMENT_AFTER_TARGET'; assessmentId: string }
  | { code: 'ASSESSMENT_IN_PAST'; assessmentId: string }
  /** No free slot before the assessment for this review or practice test. */
  | { code: 'REVIEW_UNPLACED'; key: string }

export type PlannerIssueCode = PlannerIssue['code']

export interface PlannerBuffer {
  pct: number
  minutes: number
  /** The day the plan ends if the work takes `pct` longer (walked at the plan's pace). */
  bufferedEnd: ISODate | null
}

export interface PlannerPace {
  mode: 'asap' | 'target'
  /** Study minutes per study day (token rate) in target mode; `null` = every free slot (ASAP). */
  minutesPerStudyDay: number | null
}

export interface PlannerTotals {
  study: number
  review: number
  practiceTest: number
  /** Booked assessment time. */
  assessment: number
  /** study + review + practiceTest: what the buffer is a share of. */
  work: number
}

export interface PlannerResult {
  /** By `doDate`, then `startTime` (markers last), then key. */
  items: PlanItem[]
  /** Last day with work, pinned work or an assessment. `null` when nothing is left or it cannot be computed. */
  projectedEnd: ISODate | null
  buffer: PlannerBuffer
  pace: PlannerPace
  totals: PlannerTotals
  /** Per course with work: first and last day of its study, reviews and pinned work. */
  courseWindows: CourseWindow[]
  /** `buffer.bufferedEnd − (targetDate ?? baselineEnd)` in days; positive = late. */
  slipDays: number | null
  /** Finishes (with buffer) by the target, meets every assessment date, and nothing blocks it. */
  fits: boolean
  issues: PlannerIssue[]
}

// ─── Live plan (roll-forward, "life happened") ──────────────────────────────

/** A materialized plan item as stored (a task with a planner key). */
export interface CurrentPlanItem {
  key: string
  kind: PlanItemKind
  title: string
  courseId: string | null
  unitId: string | null
  assessmentId: string | null
  doDate: ISODate
  startTime: HHmm | null
  durationMinutes: number
  dueDate: ISODate | null
  status: 'open' | 'done'
  pinned?: boolean
}

export interface LivePlanInput extends PlannerInput {
  current: readonly CurrentPlanItem[]
  /** The accepted plan's pace (`PlannerResult.pace.minutesPerStudyDay`); `null` = ASAP. */
  paceMinutesPerStudyDay: number | null
}

export interface ItemSlot {
  doDate: ISODate
  startTime: HHmm | null
}

export interface PlanMove {
  key: string
  title: string
  from: ItemSlot
  to: ItemSlot
}

/** A preview of what a proposal changes, keyed by item key. */
export interface PlanChange {
  moved: PlanMove[]
  /** Items the proposal creates (a re-plan may split work differently). */
  added: PlanItem[]
  /** Open items the proposal no longer needs (cut scope, or a review whose assessment passed). */
  removed: { key: string; title: string; reason: 'cut' | 'replanned' | 'noSlotBeforeAssessment' }[]
}
