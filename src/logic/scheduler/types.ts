/**
 * Scheduler contract (PLAN §4.1). Plain data in, plain data out: no Dexie rows are required, so the
 * goal wizard can preview a plan before anything is saved. Calendar days are local `'YYYY-MM-DD'`
 * strings; `today` is always injected.
 */
import type { Availability, ID, ISODate, Task } from '@/db/types'

export interface SchedulerOptions {
  /** Shortest chunk worth scheduling (minutes). Lowered to the largest weekday capacity when that is smaller. */
  minChunk: number
  /** Longest chunk (minutes). */
  maxChunk: number
  /** Every duration is a multiple of this (minutes). */
  grain: number
  /** How many days ahead the walk may go before giving up (`HORIZON_EXCEEDED`). */
  horizonDays: number
  /** Largest "add X min/day" catch-up that is tried. */
  maxCatchUp: number
}

export interface SchedUnit {
  id: string
  title: string
  order: number
  /** Work still to place, minutes (rounded up to the grain). ≤ 0 means nothing to do. */
  remainingMinutes: number
  /** How many chunk numbers are already taken by done or pinned chunks (`usedSeqs.length`). */
  chunkSeqStart: number
  /**
   * The chunk numbers already taken by done or pinned chunks. New chunks take the smallest free
   * numbers, so an open task keeps its key when an earlier one is finished out of order.
   * Defaults to `1…chunkSeqStart`.
   */
  usedSeqs?: readonly number[]
  /**
   * Minutes of `remainingMinutes` that may not land on `today`: the chunks the user skipped today.
   * They keep their place in the queue and are placed from the next study day on.
   */
  deferredMinutes?: number
}

export type CourseStatus = 'todo' | 'active' | 'done'

export interface SchedCourse {
  id: string
  code: string | null
  title: string
  order: number
  status: CourseStatus
  prerequisiteIds: string[]
  units: SchedUnit[]
}

/** An open, pinned chunk: it stays on its day, uses that day's capacity, and counts toward the end date. */
export interface PinnedWork {
  date: ISODate
  minutes: number
  courseId: string
}

export interface ScheduleInput {
  today: ISODate
  /** Default `today`; the wizard may pass a future `goal.startDate`. The walk starts at the later of the two. */
  startDate?: ISODate
  targetDate: ISODate | null
  /** The end date of the accepted plan; slip is measured against it when there is no target. */
  baselineEnd: ISODate | null
  courses: SchedCourse[]
  /** The goal's availability with the global days off already merged in (`mergeDaysOff`). */
  availability: Availability
  /**
   * Minutes already used per day that are not pinned work: today's finished and skipped goal
   * chunks. Pinned tasks go in `pinned`, not here.
   */
  reservedMinutes: Readonly<Record<ISODate, number>>
  pinned?: readonly PinnedWork[]
  options?: Partial<SchedulerOptions>
}

export interface PlannedChunk {
  /** `${unitId}:${seq}`: stable across rebalances, so the task for it is updated in place. */
  key: string
  date: ISODate
  minutes: number
  courseId: string
  /** The unit's id, or the course's id for a course without units (one synthetic "Study session" unit). */
  unitId: string
  seq: number
  seqTotal: number
  /** `"C182 · Operating systems (2/4)"`. */
  title: string
  /** 0-based position among the chunks placed on `date`. */
  orderInDay: number
}

export type SchedulerIssue =
  | { code: 'PREREQ_CYCLE'; courseIds: string[] }
  | { code: 'UNKNOWN_PREREQ'; courseId: string; prerequisiteId: string }
  | { code: 'NO_AVAILABILITY' }
  | { code: 'HORIZON_EXCEEDED'; unscheduledMinutes: number }
  | { code: 'TARGET_IN_PAST' }

export type SchedulerIssueCode = SchedulerIssue['code']

export interface CourseWindow {
  courseId: string
  start: ISODate
  end: ISODate
  /** Minutes of this course's open work: its chunks plus its pinned tasks. */
  minutes: number
}

export interface ScheduleResult {
  /** In date order, then `orderInDay`. */
  chunks: PlannedChunk[]
  /** One per course with open work, in schedule order. */
  windows: CourseWindow[]
  /** Minutes placed as chunks (pinned work excluded). */
  totalMinutes: number
  /** Last day with goal work (chunks or pinned). `null` when nothing remains or it cannot be computed (no availability, horizon exceeded). */
  projectedEnd: ISODate | null
  /** `projectedEnd − (targetDate ?? baselineEnd)` in days; positive = late. */
  slipDays: number | null
  feasible: boolean
  issues: SchedulerIssue[]
}

export interface CatchUp {
  /** Smallest verified "add X min to every study day" (a multiple of the grain), or `null` when none up to `maxCatchUp` works. */
  extraMinutesPerStudyDay: number | null
  /** Smallest verified uniform minutes per study day, capped at 960; `null` when impossible or no study days are left. */
  requiredMinutesPerStudyDay: number | null
  /** Days in `[start, reference]` with weekday capacity that are not days off. */
  studyDaysLeft: number
  /** The date the current plan reaches (`projectedEnd`). */
  suggestedTargetDate: ISODate | null
}

/** The task fields `diffSchedule` reads. */
export type DiffTask = Pick<
  Task,
  | 'id'
  | 'createdAt'
  | 'status'
  | 'source'
  | 'scheduleKey'
  | 'schedulePinned'
  | 'skippedOn'
  | 'doDate'
  | 'title'
  | 'estimateMinutes'
  | 'estimatePomodoros'
  | 'orderInDay'
  | 'milestoneId'
  | 'unitId'
  | 'notes'
  | 'subtasks'
  | 'tags'
  | 'priority'
>

/** The task fields a chunk owns; the rest of the row (notes, tags, status, time) belongs to the user. */
export type ChunkFields = Pick<
  Task,
  | 'title'
  | 'doDate'
  | 'estimateMinutes'
  | 'estimatePomodoros'
  | 'orderInDay'
  | 'scheduleKey'
  | 'milestoneId'
  | 'unitId'
>

export type ChunkPatch = Partial<ChunkFields & Pick<Task, 'schedulePinned'>>

export interface ChunkUpdate {
  id: ID
  chunk: PlannedChunk
  /** Only the fields that actually change. */
  changes: ChunkPatch
}

export interface ScheduleDiff {
  /** New chunks: create a task for each. */
  insert: PlannedChunk[]
  /** Existing open tasks moved or resized in place (id, notes, tags and time kept). */
  update: ChunkUpdate[]
  /** Open, unpinned tasks the plan no longer needs and the user never touched: delete. */
  remove: ID[]
  /** Like `remove`, but the user added notes, a checklist, tags, a priority or started it: detach and trash (restorable). */
  trash: ID[]
  /** Left exactly as they are: done tasks and active pins. */
  keep: ID[]
}
