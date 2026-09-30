/**
 * The Goal Breakdown Planner (PLAN §4.5): units become session-sized items placed into concrete time
 * slots inside the study windows, with spaced reviews, practice tests, assessments, weekly milestones
 * and a buffer. Pure and deterministic; `today`/`now` are injected.
 *
 * One run, in order:
 * 1. Pinned items keep their slots. Dated assessments are placed on their date (a booked time blocks its
 *    slot), and their practice test and spaced reviews are placed on the study days before it (−7, −3,
 *    −1 for an exam, scaled down when fewer study days are left; the practice test at −2).
 * 2. The flow: courses in prerequisite order (one queue, as in `buildSchedule`); each unit's sessions,
 *    then its readiness reviews; then the course's readiness reviews. Each item takes the earliest free
 *    slot at or after the previous one (plus a short break), so order is always kept and nothing
 *    overlaps. For an assessment without a date, its practice test and reviews are inserted into the
 *    flow where they should land (about k study days before the end of the course's work), and the
 *    assessment goes on the first study day after the course's last item.
 * 3. Pace. ASAP (no target): every free slot is used. With a target the flow is paced by a token bucket:
 *    each study day adds `pace` minutes (capped at max(pace, the longest item)), and an item waits for
 *    enough tokens. The pace is the smallest (binary search, each candidate verified by a run) that
 *    finishes with the buffer by the target; if even ASAP does not, the plan is ASAP and does not fit.
 * 4. Buffer: `bufferPct` of the planned work is walked as free time after the last item, at the plan's
 *    pace; `bufferedEnd` is where it ends. The plan fits when that is on or before the target.
 * 5. Weekly milestones summarize what each week finishes.
 */
import type { ISODate } from '@/db/types'
import { ceilTo, dayNumber, floorTo, isoOfDay } from './capacity'
import { dayOf, minutesOfDay } from '../dates'
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
} from './plannerTypes'
import { chunkTitle } from './schedule'
import { addBusy, busyMapOf, SlotBook, type BusyMap } from './slotBook'
import { splitMinutes } from './split'
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
  const maxSession = Math.max(minSession, floorTo(num(p.maxSessionMinutes, d.maxSessionMinutes, grain, 480), grain))
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

interface FlowItem {
  key: string
  kind: 'study' | 'review' | 'practiceTest'
  title: string
  courseId: string | null
  unitId: string | null
  assessmentId: string | null
  minutes: number
  seq: number | null
  seqTotal: number | null
  dueDate: ISODate | null
}

interface Segment {
  courseId: string | null
  items: FlowItem[]
  undated: PlannerAssessment[]
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

interface Sizes {
  target: number
  min: number
  max: number
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
  /** Study minutes a typical study day holds with whole sessions and breaks (review spacing). */
  dayThroughput: number
  maxDay: number
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

/** Minutes of whole sessions (with breaks between) that fit in a typical study day. */
function throughput(av: AvailabilityV2, session: number, brk: number): number {
  const days = (av.shiftPattern && av.shiftPattern.cycle.length > 0 ? av.shiftPattern.cycle : av.weekly)
    .map((w) => windowsToIntervals(w))
    .filter((xs) => xs.length > 0)
  if (days.length === 0 || session <= 0) return 0
  let sum = 0
  for (const xs of days) {
    let n = 0
    for (const [a, b] of xs) n += Math.floor((b - a + brk) / (session + brk))
    sum += Math.max(1, n) * session
  }
  return sum / days.length
}

function splitReviews(
  total: number,
  keyBase: string,
  title: (n: number, of: number) => string,
  sizes: Sizes,
  grain: number,
  meta: Pick<FlowItem, 'courseId' | 'unitId'>,
  skip: ReadonlySet<string>,
): FlowItem[] {
  if (!Number.isFinite(total) || total <= 0) return []
  const pieces = splitMinutes(total, { target: sizes.review, min: sizes.min, max: sizes.max, grain })
  return pieces
    .map((minutes, i) => ({
      key: `extra:${keyBase}:${i + 1}`,
      kind: 'review' as const,
      title: title(i + 1, pieces.length),
      ...meta,
      assessmentId: null,
      minutes,
      seq: null,
      seqTotal: null,
      dueDate: null,
    }))
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
  const due = a.date
  const out: Extra[] = []
  let practice: number | null = null
  if (a.kind === 'exam' && gap > 0) {
    practice = Math.min(p.s.practiceOffset, gap)
    const key = `practice:${a.id}`
    if (!p.skipKeys.has(key))
      out.push({
        offset: practice,
        item: {
          key,
          kind: 'practiceTest',
          title: `${prefix}Practice test: ${a.title}`,
          courseId: a.courseId,
          unitId: null,
          assessmentId: a.id,
          minutes: p.sizes.practice,
          seq: null,
          seqTotal: null,
          dueDate: due,
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
        key,
        kind: 'review',
        title: `${prefix}Review for ${a.title}${counter(i + 1, offsets.length)}`,
        courseId: a.courseId,
        unitId: null,
        assessmentId: a.id,
        minutes: p.sizes.review,
        seq: null,
        seqTotal: null,
        dueDate: due,
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
  const cap = (m: number): number => (noWindows ? m : Math.max(grain, Math.min(m, largest)))
  const session = num(av.sessionMinutes, 50, s.minSessionMinutes, s.maxSessionMinutes)
  const sizes: Sizes = {
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
  const open = (input.assessments ?? []).filter((a) => !a.done)
  const undatedBy = new Map<string | null, PlannerAssessment[]>()
  const datedList: PlannerAssessment[] = []
  for (const a of [...open].sort((x, y) => cmpStr(x.id, y.id))) {
    const day = safeDay(a.date)
    const courseId = a.courseId !== null && courses.has(a.courseId) ? a.courseId : null
    const norm = { ...a, courseId }
    if (a.date !== null && day === null) continue
    if (day !== null) {
      if (day < today) {
        baseIssues.push({ code: 'ASSESSMENT_IN_PAST', assessmentId: a.id })
        continue
      }
      if (target !== null && day > target)
        baseIssues.push({ code: 'ASSESSMENT_AFTER_TARGET', assessmentId: a.id })
      datedList.push(norm)
    } else {
      const list = undatedBy.get(courseId) ?? []
      list.push(norm)
      undatedBy.set(courseId, list)
    }
  }

  const prep = { s, sizes, skipKeys, courses }
  const segments: Segment[] = []
  const scheduled = new Set(order.map((c) => c.id))
  // Undated assessments of courses that are already done come first: nothing is left to study for them.
  for (const [courseId, list] of undatedBy) {
    if (courseId !== null && !scheduled.has(courseId)) segments.push({ courseId, items: [], undated: list })
  }
  for (const course of order) {
    const head = headOf(course) ?? course.title
    const items: FlowItem[] = []
    const units = [...course.units].sort((a, b) => a.order - b.order || cmpStr(a.id, b.id))
    for (const unit of units) {
      const rem = Number.isFinite(unit.remainingMinutes) && unit.remainingMinutes > 0 ? unit.remainingMinutes : 0
      const pieces = splitMinutes(rem, { target: sizes.target, min: sizes.min, max: sizes.max, grain })
      const used = new Set((unit.usedSeqs ?? []).filter((n) => Number.isInteger(n) && n > 0))
      const total = used.size + pieces.length
      let seq = 1
      for (const minutes of pieces) {
        while (used.has(seq)) seq++
        items.push({
          key: `${unit.id}:${seq}`,
          kind: 'study',
          title: chunkTitle(course, unit.title, seq, total),
          courseId: course.id,
          unitId: unit.id,
          assessmentId: null,
          minutes,
          seq,
          seqTotal: total,
          dueDate: null,
        })
        seq++
      }
      items.push(
        ...splitReviews(
          unit.extraReviewMinutes ?? 0,
          unit.id,
          (n, of) => `${head} · Review: ${unit.title}${counter(n, of)}`,
          sizes,
          grain,
          { courseId: course.id, unitId: unit.id },
          skipKeys,
        ),
      )
    }
    items.push(
      ...splitReviews(
        course.extraReviewMinutes ?? 0,
        course.id,
        (n, of) => `${head} · Review${counter(n, of)}`,
        sizes,
        grain,
        { courseId: course.id, unitId: null },
        skipKeys,
      ),
    )
    segments.push({ courseId: course.id, items, undated: undatedBy.get(course.id) ?? [] })
  }

  // Dated assessments: count the study days before each, pick the target day of every extra.
  const isStudyDay = (day: number): boolean => day >= start && dayIntervals(day).length > 0
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
    .sort((a, b) => a.day - b.day || (a.startMin ?? DAY_MINUTES) - (b.startMin ?? DAY_MINUTES) || cmpStr(a.key, b.key))

  let maxFlow = sizes.practice
  for (const seg of segments) for (const it of seg.items) maxFlow = Math.max(maxFlow, it.minutes)

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

/**
 * Inserts the practice test and reviews of undated assessments into a flow, each after the item where
 * about `(gap + 1 − offset)` study days of work are done (`rate` minutes per study day).
 */
function insertUndatedExtras(
  list: readonly FlowItem[],
  assessments: readonly PlannerAssessment[],
  rate: number,
  p: Prepared,
): FlowItem[] {
  if (assessments.length === 0) return [...list]
  const total = list.reduce((sum, it) => sum + it.minutes, 0)
  const r = rate > 0 ? rate : Math.max(1, total)
  const gap = Math.max(1, Math.ceil(total / r))
  const cum: number[] = []
  let acc = 0
  for (const it of list) cum.push((acc += it.minutes))
  const after = new Map<number, FlowItem[]>() // index of the item they follow (−1 = before all)
  const placed: Array<{ at: number; pos: number; offset: number; item: FlowItem }> = []
  for (const a of assessments) {
    for (const e of extrasFor(a, gap, p)) {
      const pos = Math.max(0, Math.min(total, (gap + 1 - e.offset) * r))
      let at = -1
      if (pos > 0) {
        at = cum.findIndex((c) => c >= pos)
        if (at === -1) at = list.length - 1
      }
      placed.push({ at, pos, offset: e.offset, item: e.item })
    }
  }
  placed.sort((x, y) => x.at - y.at || y.offset - x.offset || cmpStr(x.item.key, y.item.key))
  for (const x of placed) {
    const l = after.get(x.at) ?? []
    l.push(x.item)
    after.set(x.at, l)
  }
  const out: FlowItem[] = [...(after.get(-1) ?? [])]
  list.forEach((it, i) => {
    out.push(it, ...(after.get(i) ?? []))
  })
  return out
}

// ─── One run at a given pace ────────────────────────────────────────────────

interface Placed {
  item: FlowItem | PlanItemCore
  day: number
  start: number | null
}

/** A placed item that is not part of the flow (assessments). */
interface PlanItemCore {
  key: string
  kind: PlanItemKind
  title: string
  courseId: string | null
  unitId: string | null
  assessmentId: string | null
  minutes: number
  seq: number | null
  seqTotal: number | null
  dueDate: ISODate | null
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
}

type FlowEntry = { type: 'item'; item: FlowItem; seg: number } | { type: 'end'; seg: number }

function run(p: Prepared, pace: number | null): PlanRun {
  const { s } = p
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
  const placeAssessment = (a: PlannerAssessment, day: number, fixedStart: number | null): void => {
    const key = `assessment:${a.id}`
    assessmentDays.push(day)
    if (p.skipKeys.has(key)) return
    const head = headOf(a.courseId ? p.courses.get(a.courseId) : undefined)
    const minutes = a.durationMinutes ?? s.assessmentMinutes[a.kind]
    let start: number | null = null
    if (fixedStart !== null) {
      start = fixedStart
      if (minutes > 0) reserveSpill(day, start, minutes)
    } else if (minutes > 0) {
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
        seq: null,
        seqTotal: null,
        dueDate: isoOfDay(day),
      },
    })
  }
  for (const d of p.dated) {
    const t = d.a.time ? parseClock(d.a.time) : null
    placeAssessment(d.a, d.day, t !== null && t < DAY_MINUTES ? t : null)
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
  const rate = pace === null ? p.dayThroughput : Math.min(pace, p.dayThroughput || pace)
  let entries: FlowEntry[] = []
  p.segments.forEach((seg, i) => {
    for (const item of insertUndatedExtras(seg.items, seg.undated, rate, p)) entries.push({ type: 'item', item, seg: i })
    entries.push({ type: 'end', seg: i })
  })
  if (p.goalUndated.length > 0) {
    const flat = entries.flatMap((e) => (e.type === 'item' ? [e] : []))
    const withGoal = insertUndatedExtras(
      flat.map((e) => e.item),
      p.goalUndated,
      rate,
      p,
    )
    const segOf = new Map(flat.map((e) => [e.item.key, e.seg]))
    const ends = new Map<number, number>() // seg → index of its last item in `withGoal`
    withGoal.forEach((it, i) => {
      const sg = segOf.get(it.key)
      if (sg !== undefined) ends.set(sg, i)
    })
    const rebuilt: FlowEntry[] = []
    // Segments with no items end before everything else.
    p.segments.forEach((_seg, i) => {
      if (!ends.has(i)) rebuilt.push({ type: 'end', seg: i })
    })
    withGoal.forEach((it, i) => {
      rebuilt.push({ type: 'item', item: it, seg: segOf.get(it.key) ?? -1 })
      for (const [sg, last] of ends) if (last === i) rebuilt.push({ type: 'end', seg: sg })
    })
    entries = rebuilt
  }

  const bucket = pace === null ? Number.POSITIVE_INFINITY : Math.max(pace, p.maxFlow)
  // `min` is where the last item ended (or the start); `busy` says an item was placed on `day` already.
  const st = { day: p.start, min: p.startMinute, tokens: 0, accrued: p.start - 1, busy: false }
  const accrue = (day: number): void => {
    if (pace === null || st.accrued >= day) return
    for (let d = st.accrued + 1; d <= day; d++) if (book.isStudyDay(d)) st.tokens = Math.min(bucket, st.tokens + pace)
    st.accrued = day
  }
  const lastOfSeg = new Map<number, number>()
  const lastStudyOf = new Map<string | null, number>()
  let lastFlowDay: number | null = null
  let unscheduled = 0
  let failed = false
  const undatedDays: number[] = []
  const firstStudyDayFrom = (from: number): number | null => {
    for (let d = Math.max(from, p.start); d <= p.lastDay; d++) if (book.isStudyDay(d)) return d
    return null
  }
  const placeUndated = (list: readonly PlannerAssessment[], after: number | null): void => {
    if (list.length === 0 || failed) return
    const day = firstStudyDayFrom(after === null ? st.day : after + 1)
    if (day === null) return
    for (const a of list) placeAssessment(a, day, null)
    undatedDays.push(day)
  }

  if (!p.noWindows) {
    for (const e of entries) {
      if (failed) {
        if (e.type === 'item') unscheduled += e.item.minutes
        continue
      }
      if (e.type === 'end') {
        const seg = p.segments[e.seg]
        if (seg) placeUndated(seg.undated, lastOfSeg.get(e.seg) ?? null)
        continue
      }
      const m = e.item.minutes
      let spot: { day: number; start: number } | null = null
      while (st.day <= p.lastDay) {
        accrue(st.day)
        if (pace === null || st.tokens >= m) {
          // A break after the previous session when there is room for it; back to back when not.
          const brk = st.busy ? s.breakMinutes : 0
          const at = book.firstFit(st.day, st.min + brk, m) ?? (brk > 0 ? book.firstFit(st.day, st.min, m) : null)
          if (at !== null) {
            spot = { day: st.day, start: at }
            break
          }
        }
        st.day += 1
        st.min = 0
        st.busy = false
      }
      if (!spot) {
        failed = true
        unscheduled += m
        continue
      }
      book.reserve(spot.day, spot.start, spot.start + m)
      if (pace !== null) st.tokens -= m
      st.min = spot.start + m
      st.busy = true
      placed.push({ item: e.item, day: spot.day, start: spot.start })
      work(e.item.courseId, spot.day, m)
      lastFlowDay = spot.day
      lastOfSeg.set(e.seg, spot.day)
      if (e.item.kind === 'study') {
        lastStudyOf.set(e.item.courseId, spot.day)
        lastStudyOf.set(null, spot.day)
      }
    }
    if (!failed) placeUndated(p.goalUndated, lastFlowDay)
  } else {
    for (const e of entries) if (e.type === 'item') unscheduled += e.item.minutes
  }

  const flowMinutes = entries.reduce((n, e) => n + (e.type === 'item' ? e.item.minutes : 0), 0)
  let blocked = false
  if (unscheduled > 0) {
    blocked = true
    issues.push(p.noWindows ? { code: 'NO_AVAILABILITY' } : { code: 'HORIZON_EXCEEDED', unscheduledMinutes: unscheduled })
  }
  if (!blocked) {
    for (const d of p.dated) {
      const last = lastStudyOf.get(d.a.courseId)
      if (last !== undefined && last >= d.day)
        issues.push({ code: 'ASSESSMENT_TOO_EARLY', assessmentId: d.a.id, lastStudyDate: isoOfDay(last) })
    }
  }
  const workLeft = flowMinutes > 0 || pinnedMinutes > 0 || assessmentDays.length > 0
  if (p.target !== null && p.target < p.today && workLeft) issues.push({ code: 'TARGET_IN_PAST' })

  // Projection and buffer.
  let projectedEnd: number | null = null
  let bufferedEnd: number | null = null
  const placedWork = placed.reduce(
    (n, x) => n + (x.item.kind === 'assessment' ? 0 : x.item.minutes),
    0,
  )
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
          left -= use
          if (pace !== null) st.tokens -= use
          if (left <= 0) {
            walkEnd = d
            break
          }
        }
      }
      if (walkEnd !== null) {
        const lastUndated = undatedDays.length > 0 ? Math.max(...undatedDays) : null
        if (lastUndated !== null && lastFlowDay !== null && lastUndated > lastFlowDay && walkEnd > lastFlowDay)
          walkEnd = firstStudyDayFrom(walkEnd + 1) ?? walkEnd
        bufferedEnd = Math.max(walkEnd, projectedEnd)
      }
    }
  }

  const items = placed.map(({ item, day, start }): PlanItem => ({
    key: item.key,
    kind: item.kind,
    title: item.title,
    courseId: item.courseId,
    unitId: item.unitId,
    assessmentId: item.assessmentId,
    doDate: isoOfDay(day),
    startTime: start === null ? null : formatClock(start),
    durationMinutes: start === null ? 0 : item.minutes,
    dueDate: item.dueDate,
    seq: item.seq,
    seqTotal: item.seqTotal,
  }))

  const totals: PlannerTotals = { study: 0, review: 0, practiceTest: 0, assessment: 0, work: 0 }
  for (const it of items) {
    if (it.kind === 'study') totals.study += it.durationMinutes
    else if (it.kind === 'review') totals.review += it.durationMinutes
    else if (it.kind === 'practiceTest') totals.practiceTest += it.durationMinutes
    else if (it.kind === 'assessment') totals.assessment += it.durationMinutes
  }
  totals.work = totals.study + totals.review + totals.practiceTest

  const order = [...p.segments.map((sg) => sg.courseId), ...[...span.keys()].sort(cmpStr)]
  const seen = new Set<string>()
  const windows: CourseWindow[] = []
  for (const id of order) {
    if (id === null || seen.has(id)) continue
    seen.add(id)
    const w = span.get(id)
    if (w) windows.push({ courseId: id, start: isoOfDay(w.start), end: isoOfDay(w.end), minutes: w.minutes })
  }

  const hard = issues.some((i) =>
    ['NO_AVAILABILITY', 'HORIZON_EXCEEDED', 'ASSESSMENT_TOO_EARLY', 'ASSESSMENT_AFTER_TARGET', 'TARGET_IN_PAST'].includes(i.code),
  )
  const fits =
    !hard && (p.target === null || projectedEnd === null || (bufferedEnd !== null && bufferedEnd <= p.target))
  return { items, issues, projectedEnd, bufferedEnd, bufferMinutes, totals, windows, blocked, pace, fits }
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

export function comparePlanItems(a: PlanItem, b: PlanItem): number {
  if (a.doDate !== b.doDate) return a.doDate < b.doDate ? -1 : 1
  const ta = a.startTime ?? '99:99'
  const tb = b.startTime ?? '99:99'
  if (ta !== tb) return ta < tb ? -1 : 1
  return KIND_RANK[a.kind] - KIND_RANK[b.kind] || cmpStr(a.key, b.key)
}

/** Picks the pace: ASAP without a target, else the smallest verified pace that fits (or ASAP if none does). */
function choose(p: Prepared): PlanRun {
  if (p.target === null) return run(p, null)
  const full = run(p, null)
  if (!full.fits) return full
  const g = p.s.grain
  let lo = 1
  let hi = Math.max(1, Math.ceil(Math.max(p.maxDay, p.maxFlow) / g))
  let best: PlanRun = full
  const cache = new Map<number, PlanRun>()
  const at = (units: number): PlanRun => {
    const hit = cache.get(units)
    if (hit) return hit
    const r = run(p, units * g)
    cache.set(units, r)
    return r
  }
  if (at(hi).fits) best = at(hi)
  else return full
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const r = at(mid)
    if (r.fits) {
      hi = mid
      best = r
    } else lo = mid + 1
  }
  return best.pace === hi * g ? best : at(hi)
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
