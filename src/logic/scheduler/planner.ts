/**
 * The Goal Breakdown Planner (PLAN §4.5): units become session-sized items placed into concrete time
 * slots inside the study windows, with spaced reviews, practice tests, assessments, weekly milestones
 * and a buffer. Pure and deterministic; `today`/`now` are injected.
 *
 * One run, in order:
 * 1. Pinned items keep their slots. Dated assessments go on their date (a booked time blocks its slot;
 *    without one it is a day marker), and their practice test and spaced reviews go on the study days
 *    before it: −7, −3, −1 for an exam, scaled down when fewer study days are left, practice at −2.
 * 2. The flow: courses in prerequisite order (one queue, as in `buildSchedule`); each unit's study,
 *    then its readiness reviews; then the course's readiness reviews. Every item takes the earliest free
 *    slot at or after the previous one (after a 10-min break when there is room for one), so order is
 *    kept and nothing overlaps. Study is split as it is placed (`pieceSize`): a session of the target
 *    length when the window has room, else a shorter one (≥ 25 min) that fills the window, never
 *    leaving a remainder under 25 min. For an assessment without a date, its practice test and reviews
 *    are due at the point of the course's work that is about k study days before its end, and the
 *    assessment goes on the first study day after the course's last item.
 * 3. Pace. ASAP (no target): every free slot is used. With a target the flow is paced by a token bucket:
 *    each study day adds `pace` minutes (capped at pace + the longest item), and an item waits for
 *    enough tokens, so the average is `pace` per study day even when sessions are longer than it. The
 *    pace is the smallest (binary search, each candidate verified by a run) that finishes with the
 *    buffer by the target; if even ASAP does not, the plan is ASAP and does not fit.
 * 4. Buffer: `bufferPct` of the planned work is walked as free time after the last item, at the plan's
 *    pace; `bufferedEnd` is where it ends. The plan fits when that is on or before the target.
 * 5. Weekly milestones summarize what each week finishes.
 */
import type { ISODate } from '@/db/types'
import { dayOf, minutesOfDay } from '../dates'
import { ceilTo, dayNumber, floorTo, isoOfDay } from './capacity'
import { bufferMinutesFor, clampBufferPct } from './effort'
import { weeklyMilestones } from './milestones'
import type {
  AvailabilityV2,
  PinnedPlanItem,
  PlanItem,
  PlanItemKind,
  PlannerAssessment,
  PlannerCourse,
  PlannerInput,
  PlannerIssue,
  PlannerResult,
  PlannerSettings,
  PlannerTotals,
  PlannerUnit,
} from './plannerTypes'
import { chunkTitle } from './schedule'
import { addBusy, busyMapOf, SlotBook, type BusyMap } from './slotBook'
import { pieceSize, splitMinutes, type SplitRules } from './split'
import { orderCourses } from './topo'
import type { CourseWindow } from './types'
import {
  DAY_MINUTES,
  formatClock,
  largestWindowMinutes,
  makeDayIntervals,
  MAX_SESSION_MINUTES,
  maxDayMinutes,
  MIN_SESSION_MINUTES,
  parseClock,
  windowsToIntervals,
  type Interval,
} from './windows'

export const DEFAULT_PLANNER_SETTINGS: Readonly<PlannerSettings> = {
  bufferPct: 0.12,
  breakMinutes: 10,
  minSessionMinutes: MIN_SESSION_MINUTES,
  maxSessionMinutes: MAX_SESSION_MINUTES,
  grain: 5,
  horizonDays: 1095,
  reviewMinutes: 30,
  practiceTestMinutes: 60,
  practiceOffset: 2,
  reviewOffsets: { exam: [7, 3, 1], quiz: [1], project: [2] },
  assessmentMinutes: { exam: 120, quiz: 30, project: 60 },
  weekStartsOn: 1,
}

/** Study days an offset may reach back (reviews further out than this are not spaced any wider). */
const MAX_OFFSET = 60

const num = (v: number | undefined, d: number, lo: number, hi: number): number =>
  v !== undefined && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d

function offsetsOf(v: readonly number[] | undefined, d: readonly number[]): number[] {
  const src = v ?? d
  return [...new Set(src.filter((o) => Number.isInteger(o) && o > 0 && o <= MAX_OFFSET))].sort(
    (a, b) => b - a,
  )
}

/** Partial settings over the defaults, clamped to sane ranges. */
export function resolvePlannerSettings(p: Partial<PlannerSettings> = {}): PlannerSettings {
  const d = DEFAULT_PLANNER_SETTINGS
  const grain = Math.round(num(p.grain, d.grain, 1, 60))
  const minSession = ceilTo(num(p.minSessionMinutes, d.minSessionMinutes, grain, 240), grain)
  const maxSession = Math.max(
    minSession,
    floorTo(num(p.maxSessionMinutes, d.maxSessionMinutes, grain, 480), grain),
  )
  const ro = p.reviewOffsets
  const am = p.assessmentMinutes
  return {
    bufferPct: clampBufferPct(p.bufferPct ?? d.bufferPct),
    breakMinutes: floorTo(num(p.breakMinutes, d.breakMinutes, 0, 60), grain),
    minSessionMinutes: minSession,
    maxSessionMinutes: maxSession,
    grain,
    horizonDays: Math.round(num(p.horizonDays, d.horizonDays, 1, 3660)),
    reviewMinutes: ceilTo(num(p.reviewMinutes, d.reviewMinutes, grain, 240), grain),
    practiceTestMinutes: ceilTo(num(p.practiceTestMinutes, d.practiceTestMinutes, grain, 480), grain),
    practiceOffset: Math.round(num(p.practiceOffset, d.practiceOffset, 1, 14)),
    reviewOffsets: {
      exam: offsetsOf(ro?.exam, d.reviewOffsets.exam),
      quiz: offsetsOf(ro?.quiz, d.reviewOffsets.quiz),
      project: offsetsOf(ro?.project, d.reviewOffsets.project),
    },
    assessmentMinutes: {
      exam: ceilTo(num(am?.exam, d.assessmentMinutes.exam, 0, 720), grain),
      quiz: ceilTo(num(am?.quiz, d.assessmentMinutes.quiz, 0, 720), grain),
      project: ceilTo(num(am?.project, d.assessmentMinutes.project, 0, 720), grain),
    },
    weekStartsOn: p.weekStartsOn === 0 ? 0 : 1,
  }
}

/**
 * Review offsets scaled to the study days available (`gap`): unchanged when there are more study days
 * than the farthest offset, otherwise shrunk proportionally; always ≥ 1 and ≤ gap, deduplicated,
 * farthest first. `[7, 3, 1]` becomes `[4, 2, 1]` with 4 study days, `[2, 1]` with 2.
 */
export function scaledOffsets(offsets: readonly number[], gap: number): number[] {
  if (gap <= 0 || offsets.length === 0) return []
  const f = Math.min(1, gap / (Math.max(...offsets) + 1))
  const out = new Set<number>()
  for (const o of offsets) out.add(Math.max(1, Math.min(gap, Math.round(o * f))))
  return [...out].sort((a, b) => b - a)
}

// ─── Preparation (independent of the pace) ─────────────────────────────────

/** A fixed-length item: a review or a practice test. */
interface FlowItem {
  key: string
  kind: 'review' | 'practiceTest'
  title: string
  courseId: string | null
  unitId: string | null
  assessmentId: string | null
  minutes: number
  dueDate: ISODate | null
}

/** A unit's study, split as it is placed. */
interface UnitWork {
  course: PlannerCourse
  unit: PlannerUnit
  minutes: number
  used: ReadonlySet<number>
  /** Readiness reviews right after the unit. */
  after: FlowItem[]
}

interface Segment {
  courseId: string | null
  units: UnitWork[]
  /** The course's readiness reviews, after its last unit. */
  tail: FlowItem[]
  undated: PlannerAssessment[]
  /** Study plus readiness-review minutes. */
  flowMinutes: number
}

/** A practice test or review before an assessment, before it is placed. */
interface Extra {
  item: FlowItem
  /** Study days before the assessment. */
  offset: number
}

interface DatedPlan {
  a: PlannerAssessment
  day: number
  extras: Array<Extra & { targetDay: number | null }>
}

interface Sizes extends SplitRules {
  review: number
  practice: number
}

interface Prepared {
  input: PlannerInput
  s: PlannerSettings
  today: number
  start: number
  startMinute: number
  lastDay: number
  target: number | null
  dayIntervals: (day: number) => Interval[]
  blocked: BusyMap
  sizes: Sizes
  segments: Segment[]
  goalUndated: PlannerAssessment[]
  dated: DatedPlan[]
  pinned: Array<PinnedPlanItem & { day: number; startMin: number | null }>
  baseIssues: PlannerIssue[]
  skipKeys: ReadonlySet<string>
  courses: ReadonlyMap<string, PlannerCourse>
  /** Study minutes a typical study day holds, breaks taken out (spacing of undated reviews). */
  dayThroughput: number
  maxDay: number
  /** The longest item the flow can place. */
  maxFlow: number
  noWindows: boolean
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function headOf(course: PlannerCourse | undefined): string | null {
  if (!course) return null
  return course.code && course.code.trim() !== '' ? course.code : course.title
}

const counter = (n: number, total: number): string => (total > 1 ? ` (${n}/${total})` : '')

function safeDay(d: ISODate | null | undefined): number | null {
  if (!d) return null
  try {
    return dayNumber(d)
  } catch {
    return null
  }
}

/** Study minutes a typical study day holds: its windows less a break between target-length sessions. */
function throughput(av: AvailabilityV2, session: number, brk: number): number {
  const pattern = av.shiftPattern && av.shiftPattern.cycle.length > 0 ? av.shiftPattern.cycle : av.weekly
  const days = pattern.map((w) => windowsToIntervals(w)).filter((xs) => xs.length > 0)
  if (days.length === 0 || session <= 0) return 0
  let sum = 0
  for (const xs of days) {
    for (const [a, b] of xs) {
      const len = b - a
      const pieces = Math.max(1, Math.ceil(len / (session + brk)))
      sum += Math.max(0, len - (pieces - 1) * brk)
    }
  }
  return sum / days.length
}

function splitReviews(
  total: number,
  keyBase: string,
  title: (n: number, of: number) => string,
  sizes: Sizes,
  meta: Pick<FlowItem, 'courseId' | 'unitId'>,
  skip: ReadonlySet<string>,
): FlowItem[] {
  if (!Number.isFinite(total) || total <= 0) return []
  const pieces = splitMinutes(total, { ...sizes, target: sizes.review })
  return pieces
    .map(
      (minutes, i): FlowItem => ({
        key: `extra:${keyBase}:${i + 1}`,
        kind: 'review',
        title: title(i + 1, pieces.length),
        ...meta,
        assessmentId: null,
        minutes,
        dueDate: null,
      }),
    )
    .filter((it) => !skip.has(it.key))
}

/** The practice test and reviews for an assessment, given the study days before it. */
function extrasFor(
  a: PlannerAssessment,
  gap: number,
  p: Pick<Prepared, 's' | 'sizes' | 'skipKeys' | 'courses'>,
): Extra[] {
  const head = headOf(a.courseId ? p.courses.get(a.courseId) : undefined)
  const prefix = head ? `${head} · ` : ''
  const base = { courseId: a.courseId, unitId: null, assessmentId: a.id, dueDate: a.date }
  const out: Extra[] = []
  let practice: number | null = null
  if (a.kind === 'exam' && gap > 0) {
    practice = Math.min(p.s.practiceOffset, gap)
    const key = `practice:${a.id}`
    if (!p.skipKeys.has(key))
      out.push({
        offset: practice,
        item: {
          ...base,
          key,
          kind: 'practiceTest',
          title: `${prefix}Practice test: ${a.title}`,
          minutes: p.sizes.practice,
        },
      })
  }
  const offsets = scaledOffsets(p.s.reviewOffsets[a.kind], gap).filter((o) => o !== practice)
  offsets.forEach((offset, i) => {
    const key = `review:${a.id}:${i + 1}`
    if (p.skipKeys.has(key)) return
    out.push({
      offset,
      item: {
        ...base,
        key,
        kind: 'review',
        title: `${prefix}Review for ${a.title}${counter(i + 1, offsets.length)}`,
        minutes: p.sizes.review,
      },
    })
  })
  return out.sort((x, y) => y.offset - x.offset || cmpStr(x.item.key, y.item.key))
}

function prepare(input: PlannerInput): Prepared {
  const s = resolvePlannerSettings(input.settings)
  const { grain } = s
  const av = input.availability
  const today = dayNumber(input.today)
  const start = Math.max(today, safeDay(input.startDate) ?? today)
  let startMinute = 0
  if (input.now !== undefined && input.now !== null && start === today && dayOf(input.now) === input.today)
    startMinute = Math.min(DAY_MINUTES, ceilTo(minutesOfDay(input.now), grain))
  const dayIntervals = makeDayIntervals(av)
  const largest = floorTo(largestWindowMinutes(av), grain)
  const noWindows = largest <= 0
  // Nothing may be longer than the longest window, or it could never be placed.
  const cap = (m: number): number => (noWindows ? m : Math.max(grain, Math.min(m, largest)))
  const session = num(av.sessionMinutes, 50, s.minSessionMinutes, s.maxSessionMinutes)
  const sizes: Sizes = {
    grain,
    target: cap(ceilTo(session, grain)),
    min: cap(s.minSessionMinutes),
    max: cap(s.maxSessionMinutes),
    review: cap(s.reviewMinutes),
    practice: cap(s.practiceTestMinutes),
  }

  const skipKeys = new Set<string>([
    ...(input.completedKeys ?? []),
    ...(input.pinned ?? []).map((p) => p.key),
  ])
  const courses = new Map<string, PlannerCourse>()
  for (const c of input.courses) if (!courses.has(c.id)) courses.set(c.id, c)
  const { order, issues } = orderCourses(input.courses)
  const baseIssues: PlannerIssue[] = [...issues]
  const target = safeDay(input.targetDate)

  // Assessments: dated (placed first), undated per course, and goal-level.
  const undatedBy = new Map<string | null, PlannerAssessment[]>()
  const datedList: PlannerAssessment[] = []
  for (const a of [...(input.assessments ?? [])].sort((x, y) => cmpStr(x.id, y.id))) {
    if (a.done) continue
    const day = safeDay(a.date)
    const norm = { ...a, courseId: a.courseId !== null && courses.has(a.courseId) ? a.courseId : null }
    if (a.date !== null && day === null) continue
    if (day === null) {
      const list = undatedBy.get(norm.courseId) ?? []
      list.push(norm)
      undatedBy.set(norm.courseId, list)
    } else if (day < today) {
      baseIssues.push({ code: 'ASSESSMENT_IN_PAST', assessmentId: a.id })
    } else {
      if (target !== null && day > target)
        baseIssues.push({ code: 'ASSESSMENT_AFTER_TARGET', assessmentId: a.id })
      datedList.push(norm)
    }
  }

  const segments: Segment[] = []
  const scheduled = new Set(order.map((c) => c.id))
  // Undated assessments of courses already done come first: nothing is left to study for them.
  for (const [courseId, list] of undatedBy) {
    if (courseId !== null && !scheduled.has(courseId))
      segments.push({ courseId, units: [], tail: [], undated: list, flowMinutes: 0 })
  }
  for (const course of order) {
    const head = headOf(course) ?? course.title
    const units: UnitWork[] = []
    let flowMinutes = 0
    for (const unit of [...course.units].sort((a, b) => a.order - b.order || cmpStr(a.id, b.id))) {
      const raw = unit.remainingMinutes
      const minutes = Number.isFinite(raw) && raw > 0 ? ceilTo(raw, grain) : 0
      const after = splitReviews(
        unit.extraReviewMinutes ?? 0,
        unit.id,
        (n, of) => `${head} · Review: ${unit.title}${counter(n, of)}`,
        sizes,
        { courseId: course.id, unitId: unit.id },
        skipKeys,
      )
      if (minutes === 0 && after.length === 0) continue
      const used = new Set((unit.usedSeqs ?? []).filter((n) => Number.isInteger(n) && n > 0))
      units.push({ course, unit, minutes, used, after })
      flowMinutes += minutes + after.reduce((n, it) => n + it.minutes, 0)
    }
    const tail = splitReviews(
      course.extraReviewMinutes ?? 0,
      course.id,
      (n, of) => `${head} · Review${counter(n, of)}`,
      sizes,
      { courseId: course.id, unitId: null },
      skipKeys,
    )
    flowMinutes += tail.reduce((n, it) => n + it.minutes, 0)
    segments.push({ courseId: course.id, units, tail, undated: undatedBy.get(course.id) ?? [], flowMinutes })
  }

  // Dated assessments: the study days before each, and the target day of every extra.
  const isStudyDay = (day: number): boolean => day >= start && dayIntervals(day).length > 0
  const prep = { s, sizes, skipKeys, courses }
  const dated: DatedPlan[] = datedList
    .map((a) => ({ a, day: dayNumber(a.date as ISODate) }))
    .sort((x, y) => x.day - y.day || cmpStr(x.a.id, y.a.id))
    .map(({ a, day }) => {
      const before: number[] = [] // study days before the assessment, nearest first
      for (let d = day - 1; d >= start && before.length <= MAX_OFFSET; d--)
        if (isStudyDay(d)) before.push(d)
      const extras = extrasFor(a, before.length, prep).map((e) => ({
        ...e,
        targetDay: before[e.offset - 1] ?? before[before.length - 1] ?? null,
      }))
      return { a, day, extras }
    })

  const pinned = (input.pinned ?? [])
    .map((p) => ({ ...p, day: safeDay(p.date) ?? -1, startMin: p.startTime ? parseClock(p.startTime) : null }))
    .filter((p) => p.day >= start && Number.isFinite(p.durationMinutes) && p.durationMinutes > 0)
    .sort(
      (a, b) =>
        a.day - b.day ||
        (a.startMin ?? DAY_MINUTES) - (b.startMin ?? DAY_MINUTES) ||
        cmpStr(a.key, b.key),
    )

  let maxFlow = Math.max(sizes.max, sizes.practice, sizes.review)
  for (const seg of segments)
    for (const it of [...seg.tail, ...seg.units.flatMap((u) => u.after)]) maxFlow = Math.max(maxFlow, it.minutes)

  return {
    input,
    s,
    today,
    start,
    startMinute,
    lastDay: start + s.horizonDays - 1,
    target,
    dayIntervals,
    blocked: busyMapOf(input.blockedSlots),
    sizes,
    segments,
    goalUndated: undatedBy.get(null) ?? [],
    dated,
    pinned,
    baseIssues,
    skipKeys,
    courses,
    dayThroughput: throughput(av, sizes.target, s.breakMinutes),
    maxDay: maxDayMinutes(av),
    maxFlow,
    noWindows,
  }
}

interface Pending {
  /** Due once this many minutes of the segment's (or the goal's) flow are placed. */
  pos: number
  offset: number
  item: FlowItem
}

/**
 * The practice tests and reviews of undated assessments, each due at the point of the flow that is about
 * `(gap + 1 − offset)` study days in (`rate` minutes per study day), so it lands `offset` study days
 * before the assessment. `total` = the flow's minutes.
 */
function pendingExtras(
  assessments: readonly PlannerAssessment[],
  total: number,
  rate: number,
  p: Prepared,
): Pending[] {
  if (assessments.length === 0) return []
  const r = rate > 0 ? rate : Math.max(1, total)
  const gap = Math.max(1, Math.ceil(total / r))
  const out: Pending[] = []
  for (const a of assessments)
    for (const e of extrasFor(a, gap, p))
      out.push({ pos: Math.max(0, Math.min(total, (gap + 1 - e.offset) * r)), offset: e.offset, item: e.item })
  return out.sort((x, y) => x.pos - y.pos || y.offset - x.offset || cmpStr(x.item.key, y.item.key))
}

// ─── One run at a given pace ────────────────────────────────────────────────

interface PlacedCore {
  key: string
  kind: PlanItemKind
  title: string
  courseId: string | null
  unitId: string | null
  assessmentId: string | null
  minutes: number
  dueDate: ISODate | null
  /** Study pieces: numbered after the run, when each unit's count is known. */
  work?: UnitWork
  seq?: number
}

interface Placed {
  item: PlacedCore
  day: number
  start: number | null
}

export interface PlanRun {
  items: PlanItem[]
  issues: PlannerIssue[]
  projectedEnd: number | null
  bufferedEnd: number | null
  bufferMinutes: number
  totals: PlannerTotals
  windows: CourseWindow[]
  blocked: boolean
  pace: number | null
  fits: boolean
  /**
   * With a target: minutes that do not fit by it (work after it, the part of the buffer it cuts off,
   * study on or after a dated assessment of its course), or everything left unplaced. 0 without a target.
   */
  shortfall: number
}

const HARD: ReadonlySet<string> = new Set([
  'NO_AVAILABILITY',
  'HORIZON_EXCEEDED',
  'ASSESSMENT_TOO_EARLY',
  'ASSESSMENT_AFTER_TARGET',
  'TARGET_IN_PAST',
])

function run(p: Prepared, pace: number | null): PlanRun {
  const { s, sizes } = p
  const book = new SlotBook({
    dayIntervals: p.dayIntervals,
    busy: p.blocked,
    startDay: p.start,
    startMinute: p.startMinute,
    grain: s.grain,
  })
  const placed: Placed[] = []
  const issues: PlannerIssue[] = [...p.baseIssues]
  const span = new Map<string, { start: number; end: number; minutes: number }>()
  let workEnd: number | null = null
  const work = (courseId: string | null, day: number, minutes: number): void => {
    workEnd = workEnd === null ? day : Math.max(workEnd, day)
    if (courseId === null) return
    const w = span.get(courseId)
    if (!w) span.set(courseId, { start: day, end: day, minutes })
    else {
      w.start = Math.min(w.start, day)
      w.end = Math.max(w.end, day)
      w.minutes += minutes
    }
  }
  const reserveSpill = (day: number, startMin: number, minutes: number): void => {
    const tmp: BusyMap = new Map()
    addBusy(tmp, day, startMin, minutes)
    for (const [d, xs] of tmp) for (const [a, b] of xs) book.reserve(d, a, b)
  }

  // 1a. Pinned items.
  let pinnedMinutes = 0
  for (const pin of p.pinned) {
    if (pin.startMin !== null) reserveSpill(pin.day, pin.startMin, pin.durationMinutes)
    else {
      const at = book.firstFit(pin.day, 0, pin.durationMinutes)
      if (at !== null) book.reserve(pin.day, at, at + pin.durationMinutes)
    }
    pinnedMinutes += pin.durationMinutes
    work(pin.courseId, pin.day, pin.durationMinutes)
  }

  // 1b. Dated assessments, then their practice tests and reviews near their target days.
  const assessmentDays: number[] = []
  // `fixedStart`: a booked time. Otherwise `findSlot` says whether to give it the day's first free slot
  // (an undated assessment the plan places) or leave it a day marker (a date without a booked time).
  const placeAssessment = (a: PlannerAssessment, day: number, fixedStart: number | null, findSlot: boolean): void => {
    const key = `assessment:${a.id}`
    assessmentDays.push(day)
    if (p.skipKeys.has(key)) return
    const head = headOf(a.courseId ? p.courses.get(a.courseId) : undefined)
    const minutes = a.durationMinutes ?? s.assessmentMinutes[a.kind]
    let start: number | null = null
    if (fixedStart !== null) {
      start = fixedStart
      if (minutes > 0) reserveSpill(day, start, minutes)
    } else if (findSlot && minutes > 0) {
      start = book.firstFit(day, 0, minutes)
      if (start !== null) book.reserve(day, start, start + minutes)
    }
    placed.push({
      day,
      start,
      item: {
        key,
        kind: 'assessment',
        title: head ? `${head} · ${a.title}` : a.title,
        courseId: a.courseId,
        unitId: null,
        assessmentId: a.id,
        minutes: start === null ? 0 : minutes,
        dueDate: isoOfDay(day),
      },
    })
  }
  for (const d of p.dated) {
    const t = d.a.time ? parseClock(d.a.time) : null
    placeAssessment(d.a, d.day, t !== null && t < DAY_MINUTES ? t : null, false)
    for (const e of d.extras) {
      const spot = e.targetDay === null ? null : nearSlot(book, e.targetDay, p.start, d.day - 1, e.item.minutes)
      if (!spot) {
        issues.push({ code: 'REVIEW_UNPLACED', key: e.item.key })
        continue
      }
      book.reserve(spot.day, spot.start, spot.start + e.item.minutes)
      placed.push({ item: e.item, day: spot.day, start: spot.start })
      work(e.item.courseId, spot.day, e.item.minutes)
    }
  }

  // 2. The flow.
  const bucket = pace === null ? Number.POSITIVE_INFINITY : pace + p.maxFlow
  // `min`: where the last item ended (or the start); `busy`: an item was already placed on `day`.
  const st = { day: p.start, min: p.startMinute, tokens: 0, accrued: p.start - 1, busy: false }
  const accrue = (day: number): void => {
    if (pace === null || st.accrued >= day) return
    for (let d = st.accrued + 1; d <= day; d++)
      if (book.isStudyDay(d)) st.tokens = Math.min(bucket, st.tokens + pace)
    st.accrued = day
  }
  const nextDay = (): void => {
    st.day += 1
    st.min = 0
    st.busy = false
  }
  const take = (day: number, start: number, minutes: number): void => {
    book.reserve(day, start, start + minutes)
    if (pace !== null) st.tokens -= minutes
    st.min = start + minutes
    st.busy = true
  }
  /** A fixed-length item at the next slot; a break before it when there is room. `false` past the horizon. */
  const placeFixed = (item: FlowItem): boolean => {
    for (; st.day <= p.lastDay; nextDay()) {
      accrue(st.day)
      if (pace !== null && st.tokens < item.minutes) continue
      const brk = st.busy ? s.breakMinutes : 0
      const at =
        book.firstFit(st.day, st.min + brk, item.minutes) ??
        (brk > 0 ? book.firstFit(st.day, st.min, item.minutes) : null)
      if (at === null) continue
      take(st.day, at, item.minutes)
      placed.push({ item, day: st.day, start: at })
      work(item.courseId, st.day, item.minutes)
      return true
    }
    return false
  }
  /** The next study piece of a unit: its minutes, or 0 past the horizon. */
  const placeStudy = (uw: UnitWork, left: number, seq: number): number => {
    const tryAt = (from: number): { at: number; size: number } | null => {
      for (const [a, b] of book.freeOn(st.day)) {
        if (b <= from) continue
        const at = ceilTo(Math.max(a, from), s.grain)
        const size = pieceSize(left, b - at, sizes)
        if (size !== null && (pace === null || st.tokens >= size)) return { at, size }
      }
      return null
    }
    for (; st.day <= p.lastDay; nextDay()) {
      accrue(st.day)
      if (pace !== null && st.tokens < Math.min(left, sizes.min)) continue
      const hit = tryAt(st.min + (st.busy ? s.breakMinutes : 0)) ?? (st.busy ? tryAt(st.min) : null)
      if (!hit) continue
      take(st.day, hit.at, hit.size)
      placed.push({
        day: st.day,
        start: hit.at,
        item: {
          key: `${uw.unit.id}:${seq}`,
          kind: 'study',
          title: '',
          courseId: uw.course.id,
          unitId: uw.unit.id,
          assessmentId: null,
          minutes: hit.size,
          dueDate: null,
          work: uw,
          seq,
        },
      })
      work(uw.course.id, st.day, hit.size)
      return hit.size
    }
    return 0
  }

  const rate = pace === null ? p.dayThroughput : Math.min(pace, p.dayThroughput || pace)
  const totalFlow = p.segments.reduce((n, sg) => n + sg.flowMinutes, 0)
  const goalPending = pendingExtras(p.goalUndated, totalFlow, rate, p)
  let unscheduled = 0
  let failed = false
  let lastFlowDay: number | null = null
  const lastStudyOf = new Map<string | null, number>()
  const undatedDays: number[] = []
  let globalProgress = 0

  const firstStudyDayFrom = (from: number): number | null => {
    for (let d = Math.max(from, p.start); d <= p.lastDay; d++) if (book.isStudyDay(d)) return d
    return null
  }
  const placeUndated = (list: readonly PlannerAssessment[], after: number | null): void => {
    if (list.length === 0 || failed) return
    const day = firstStudyDayFrom(after === null ? st.day : after + 1)
    if (day === null) return
    for (const a of list) placeAssessment(a, day, null, true)
    undatedDays.push(day)
  }

  if (p.noWindows) failed = true
  for (const seg of p.segments) {
    const pending = pendingExtras(seg.undated, seg.flowMinutes, rate, p)
    let progress = 0
    let lastOfSeg: number | null = null
    const fixed = (item: FlowItem): void => {
      if (failed) {
        unscheduled += item.minutes
        return
      }
      if (!placeFixed(item)) {
        failed = true
        unscheduled += item.minutes
        return
      }
      lastOfSeg = lastFlowDay = st.day
    }
    const flush = (all: boolean): void => {
      while (pending.length > 0 && (all || (pending[0] as Pending).pos <= progress))
        fixed((pending.shift() as Pending).item)
      while (goalPending.length > 0 && (goalPending[0] as Pending).pos <= globalProgress)
        fixed((goalPending.shift() as Pending).item)
    }
    for (const uw of seg.units) {
      let left = uw.minutes
      let seq = 1
      while (left > 0) {
        flush(false)
        if (failed) break
        while (uw.used.has(seq)) seq++
        const m = placeStudy(uw, left, seq)
        if (m === 0) {
          failed = true
          break
        }
        seq++
        left -= m
        progress += m
        globalProgress += m
        lastOfSeg = lastFlowDay = st.day
        lastStudyOf.set(uw.course.id, st.day)
        lastStudyOf.set(null, st.day)
      }
      unscheduled += left
      for (const it of uw.after) {
        flush(false)
        fixed(it)
        progress += it.minutes
        globalProgress += it.minutes
      }
    }
    for (const it of seg.tail) {
      flush(false)
      fixed(it)
      progress += it.minutes
      globalProgress += it.minutes
    }
    flush(true)
    placeUndated(seg.undated, lastOfSeg)
  }
  while (goalPending.length > 0) {
    const it = (goalPending.shift() as Pending).item
    if (failed || !placeFixed(it)) {
      failed = true
      unscheduled += it.minutes
    } else lastFlowDay = st.day
  }
  placeUndated(p.goalUndated, lastFlowDay)

  // Issues.
  let blocked = false
  if (failed || unscheduled > 0) {
    blocked = true
    issues.push(
      p.noWindows ? { code: 'NO_AVAILABILITY' } : { code: 'HORIZON_EXCEEDED', unscheduledMinutes: unscheduled },
    )
  }
  if (!blocked) {
    for (const d of p.dated) {
      const last = lastStudyOf.get(d.a.courseId)
      if (last !== undefined && last >= d.day)
        issues.push({ code: 'ASSESSMENT_TOO_EARLY', assessmentId: d.a.id, lastStudyDate: isoOfDay(last) })
    }
  }
  const workLeft = totalFlow > 0 || pinnedMinutes > 0 || assessmentDays.length > 0
  if (p.target !== null && p.target < p.today && workLeft) issues.push({ code: 'TARGET_IN_PAST' })

  // Projection and buffer.
  let projectedEnd: number | null = null
  let bufferedEnd: number | null = null
  let bufferByTarget = 0
  const placedWork = placed.reduce((n, x) => n + (x.item.kind === 'assessment' ? 0 : x.item.minutes), 0)
  const bufferMinutes = bufferMinutesFor(placedWork + pinnedMinutes, s.bufferPct, s.grain)
  if (!blocked) {
    const ends = [workEnd, ...assessmentDays].filter((d): d is number => d !== null)
    projectedEnd = ends.length > 0 ? Math.max(...ends) : null
    if (projectedEnd !== null) {
      let walkEnd: number | null = lastFlowDay ?? workEnd
      let left = bufferMinutes
      if (left > 0) {
        walkEnd = null
        for (let d = st.day; d <= p.lastDay; d++) {
          accrue(d)
          const free = book.freeMinutesFrom(d, d === st.day ? st.min : 0)
          const use = pace === null ? free : Math.min(free, Math.max(0, st.tokens))
          if (p.target !== null && d <= p.target) bufferByTarget += Math.min(use, left)
          left -= use
          if (pace !== null) st.tokens -= use
          if (left <= 0) {
            walkEnd = d
            break
          }
        }
      }
      if (walkEnd !== null) {
        // An undated assessment right after the work slides with the buffer.
        const lastUndated = undatedDays.length > 0 ? Math.max(...undatedDays) : null
        if (lastUndated !== null && lastFlowDay !== null && lastUndated > lastFlowDay && walkEnd > lastFlowDay)
          walkEnd = firstStudyDayFrom(walkEnd + 1) ?? walkEnd
        bufferedEnd = Math.max(walkEnd, projectedEnd)
      }
    }
  }

  // Study titles need each unit's final count.
  const counts = new Map<string, number>()
  for (const x of placed) if (x.item.work) counts.set(x.item.work.unit.id, (counts.get(x.item.work.unit.id) ?? 0) + 1)
  const items = placed.map(({ item, day, start }): PlanItem => {
    const uw = item.work
    const seqTotal = uw ? uw.used.size + (counts.get(uw.unit.id) ?? 0) : null
    return {
      key: item.key,
      kind: item.kind,
      title: uw ? chunkTitle(uw.course, uw.unit.title, item.seq ?? 1, seqTotal ?? 1) : item.title,
      courseId: item.courseId,
      unitId: item.unitId,
      assessmentId: item.assessmentId,
      doDate: isoOfDay(day),
      startTime: start === null ? null : formatClock(start),
      durationMinutes: start === null ? 0 : item.minutes,
      dueDate: item.dueDate,
      seq: uw ? (item.seq ?? null) : null,
      seqTotal,
    }
  })

  const totals: PlannerTotals = { study: 0, review: 0, practiceTest: 0, assessment: 0, work: 0 }
  for (const it of items) {
    if (it.kind === 'study') totals.study += it.durationMinutes
    else if (it.kind === 'review') totals.review += it.durationMinutes
    else if (it.kind === 'practiceTest') totals.practiceTest += it.durationMinutes
    else if (it.kind === 'assessment') totals.assessment += it.durationMinutes
  }
  totals.work = totals.study + totals.review + totals.practiceTest

  const windows: CourseWindow[] = []
  const seen = new Set<string>()
  for (const id of [...p.segments.map((sg) => sg.courseId), ...[...span.keys()].sort(cmpStr)]) {
    if (id === null || seen.has(id)) continue
    seen.add(id)
    const w = span.get(id)
    if (w) windows.push({ courseId: id, start: isoOfDay(w.start), end: isoOfDay(w.end), minutes: w.minutes })
  }

  let shortfall = 0
  if (blocked) shortfall = unscheduled
  else if (p.target !== null) {
    const target = p.target
    for (const x of placed) if (x.item.kind !== 'assessment' && x.day > target) shortfall += x.item.minutes
    shortfall += Math.max(0, bufferMinutes - bufferByTarget)
    for (const d of p.dated) {
      if (!issues.some((i) => i.code === 'ASSESSMENT_TOO_EARLY' && i.assessmentId === d.a.id)) continue
      for (const x of placed)
        if (x.item.kind === 'study' && x.day >= d.day && x.day <= target && (d.a.courseId === null || x.item.courseId === d.a.courseId))
          shortfall += x.item.minutes
    }
  }

  const hard = issues.some((i) => HARD.has(i.code))
  const fits =
    !hard && (p.target === null || projectedEnd === null || (bufferedEnd !== null && bufferedEnd <= p.target))
  return { items, issues, projectedEnd, bufferedEnd, bufferMinutes, totals, windows, blocked, pace, fits, shortfall }
}

/**
 * A free slot for `minutes` on or near `target`: the target day, then earlier days down to `lo`, then
 * later days up to `hi`.
 */
function nearSlot(
  book: SlotBook,
  target: number,
  lo: number,
  hi: number,
  minutes: number,
): { day: number; start: number } | null {
  for (let d = Math.min(target, hi); d >= lo; d--) {
    const at = book.firstFit(d, 0, minutes)
    if (at !== null) return { day: d, start: at }
  }
  for (let d = target + 1; d <= hi; d++) {
    const at = book.firstFit(d, 0, minutes)
    if (at !== null) return { day: d, start: at }
  }
  return null
}

// ─── Public API ─────────────────────────────────────────────────────────────

const KIND_RANK: Record<PlanItemKind, number> = {
  assessment: 0,
  practiceTest: 1,
  review: 2,
  study: 3,
  milestone: 4,
}

/** Plan order: day, then start time (day markers last), then kind, then key. */
export function comparePlanItems(a: PlanItem, b: PlanItem): number {
  if (a.doDate !== b.doDate) return a.doDate < b.doDate ? -1 : 1
  const ta = a.startTime ?? '99:99'
  const tb = b.startTime ?? '99:99'
  if (ta !== tb) return ta < tb ? -1 : 1
  return KIND_RANK[a.kind] - KIND_RANK[b.kind] || cmpStr(a.key, b.key)
}

/** Picks the pace: ASAP without a target, else the smallest verified pace that fits (or ASAP if none does). */
function choose(p: Prepared): PlanRun {
  const full = run(p, null)
  if (p.target === null || !full.fits) return full
  const g = p.s.grain
  const cache = new Map<number, PlanRun>()
  const at = (units: number): PlanRun => {
    const hit = cache.get(units)
    if (hit) return hit
    const r = run(p, units * g)
    cache.set(units, r)
    return r
  }
  let lo = 1
  let hi = Math.max(1, Math.ceil(Math.max(p.maxDay, p.maxFlow) / g))
  if (!at(hi).fits) return full
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (at(mid).fits) hi = mid
    else lo = mid + 1
  }
  return at(hi)
}

/**
 * The plan without milestones, with day numbers (for feasibility checks that re-run it many times).
 * `pace` forces a pace instead of choosing one (`null` = ASAP).
 */
export function planRun(input: PlannerInput, pace?: number | null): PlanRun {
  const p = prepare(input)
  return pace === undefined ? choose(p) : run(p, pace)
}

/** Plans the remaining work of a goal into time slots. Equal input gives deep-equal output. */
export function planStudy(input: PlannerInput): PlannerResult {
  const p = prepare(input)
  const r = choose(p)
  const items = [...r.items]
  items.push(...weeklyMilestones(items, input.courses, p.s.weekStartsOn))
  items.sort(comparePlanItems)
  const reference = safeDay(input.targetDate ?? input.baselineEnd ?? null)
  return {
    items,
    projectedEnd: r.projectedEnd === null ? null : isoOfDay(r.projectedEnd),
    buffer: {
      pct: p.s.bufferPct,
      minutes: r.bufferMinutes,
      bufferedEnd: r.bufferedEnd === null ? null : isoOfDay(r.bufferedEnd),
    },
    pace: { mode: p.target === null ? 'asap' : 'target', minutesPerStudyDay: r.pace },
    totals: r.totals,
    courseWindows: r.windows,
    slipDays: r.projectedEnd !== null && reference !== null ? r.projectedEnd - reference : null,
    fits: r.fits,
    issues: r.issues,
  }
}

/** The token-bucket headroom a paced plan allows over its pace (the longest item the flow can place). */
export function flowHeadroom(input: PlannerInput): number {
  return prepare(input).maxFlow
}

/**
 * Free study minutes from the plan's start (and `now`) through `until`: windows minus blocked slots and
 * timed pins. The raw capacity the feasibility check compares the work against.
 */
export function freeMinutesUntil(input: PlannerInput, until: ISODate): number {
  const p = prepare(input)
  const end = safeDay(until)
  if (end === null || end < p.start) return 0
  const book = new SlotBook({
    dayIntervals: p.dayIntervals,
    busy: p.blocked,
    startDay: p.start,
    startMinute: p.startMinute,
    grain: p.s.grain,
  })
  for (const pin of p.pinned)
    if (pin.startMin !== null) book.reserve(pin.day, pin.startMin, pin.startMin + pin.durationMinutes)
  let n = 0
  for (let d = p.start; d <= end; d++) n += book.freeMinutesFrom(d, 0)
  return n
}
