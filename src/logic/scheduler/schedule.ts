/**
 * The scheduler (PLAN §4.2): courses in prerequisite order become one queue of units, and the walk
 * fills each available day from the head of the queue, never above the day's capacity.
 *
 * Chunk rule (minEff = min(minChunk, largest weekday capacity), default 25; maxChunk default 90):
 *   take = min(maxChunk, unit remainder, day capacity left)
 *   If that would leave a tail shorter than minEff, and the unit is at least 2 × minEff, take
 *   `remainder − minEff` instead, so the last piece is exactly minEff (100 min on a 120-min day is
 *   75 + 25, not 90 + 10).
 *   A day with less than minEff left takes only a unit's whole remainder, so it never starts a piece it
 *   cannot finish at a proper length.
 * So every chunk is within [minEff, maxChunk] except a unit's final chunk, which may be shorter (a
 * unit smaller than minEff, or one between minEff and 2 × minEff split by a short day).
 *
 * Skipped work (`deferredMinutes`) may not go on `today`: on that day only the rest of the unit is
 * available, and only in pieces of at least minEff; the walk looks past it to later units for the
 * remaining time. That is the one place the queue order is relaxed, for one day.
 */
import type { ISODate } from '@/db/types'
import {
  ceilTo,
  dayNumber,
  dayRanges,
  floorTo,
  inRanges,
  isoOfDay,
  resolveOptions,
  weekCaps,
  weekdayOfDay,
} from './capacity'
import { scheduleKey } from './estimates'
import { orderCourses } from './topo'
import type {
  CourseWindow,
  PlannedChunk,
  SchedCourse,
  ScheduleInput,
  ScheduleResult,
  SchedulerIssue,
  SchedulerOptions,
  SchedUnit,
} from './types'

interface QueueUnit {
  course: SchedCourse
  unit: SchedUnit
  /** Remaining minutes, grain-aligned. */
  minutes: number
  /** Minutes that may not go on `today`. */
  deferred: number
}

interface Pin {
  day: number
  minutes: number
  courseId: string
}

/** Everything the walk needs, computed once so catch-up can re-walk cheaply with other capacities. */
export interface PreparedSchedule {
  input: ScheduleInput
  opts: SchedulerOptions
  today: number
  start: number
  queue: readonly QueueUnit[]
  totalMinutes: number
  topoIssues: SchedulerIssue[]
  off: ReadonlyArray<readonly [number, number]>
  reserved: ReadonlyMap<number, number>
  pins: readonly Pin[]
  pinnedEnd: number | null
  /** Weekday capacities from the input availability, grain-floored. */
  caps: readonly number[]
  target: number | null
}

interface Placement {
  day: number
  q: number
  minutes: number
  orderInDay: number
}

export interface WalkResult {
  placements: Placement[]
  /** Minutes still in the queue when the walk stopped. */
  unscheduled: number
  /** No weekday has any capacity. */
  noCapacity: boolean
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export function chunkTitle(
  course: Pick<SchedCourse, 'code' | 'title'>,
  unitTitle: string,
  seq: number,
  seqTotal: number,
): string {
  const head = course.code && course.code.trim() !== '' ? course.code : course.title
  return `${head} · ${unitTitle}${seqTotal > 1 ? ` (${seq}/${seqTotal})` : ''}`
}

export function prepareSchedule(input: ScheduleInput): PreparedSchedule {
  const opts = resolveOptions(input.options)
  const { grain } = opts
  const today = dayNumber(input.today)
  const start = Math.max(today, input.startDate ? dayNumber(input.startDate) : today)

  const { order, issues } = orderCourses(input.courses)
  const queue: QueueUnit[] = []
  let totalMinutes = 0
  for (const course of order) {
    const units = [...course.units].sort((a, b) => a.order - b.order || cmpStr(a.id, b.id))
    for (const unit of units) {
      const raw = unit.remainingMinutes
      const minutes = Number.isFinite(raw) && raw > 0 ? ceilTo(raw, grain) : 0
      if (minutes === 0) continue
      const d = unit.deferredMinutes ?? 0
      const deferred = Number.isFinite(d) && d > 0 ? Math.min(minutes, ceilTo(d, grain)) : 0
      queue.push({ course, unit, minutes, deferred })
      totalMinutes += minutes
    }
  }

  const reserved = new Map<number, number>()
  for (const [iso, m] of Object.entries(input.reservedMinutes)) {
    if (!Number.isFinite(m) || m <= 0) continue
    const day = dayNumber(iso)
    reserved.set(day, (reserved.get(day) ?? 0) + m)
  }
  const pins: Pin[] = []
  let pinnedEnd: number | null = null
  for (const p of input.pinned ?? []) {
    if (!Number.isFinite(p.minutes) || p.minutes <= 0) continue
    const day = dayNumber(p.date)
    if (day < start) continue
    pins.push({ day, minutes: p.minutes, courseId: p.courseId })
    reserved.set(day, (reserved.get(day) ?? 0) + p.minutes)
    pinnedEnd = pinnedEnd === null ? day : Math.max(pinnedEnd, day)
  }

  return {
    input,
    opts,
    today,
    start,
    queue,
    totalMinutes,
    topoIssues: issues,
    off: dayRanges(input.availability.daysOff),
    reserved,
    pins,
    pinnedEnd,
    caps: weekCaps(input.availability.minutesByWeekday, grain),
    target: input.targetDate ? dayNumber(input.targetDate) : null,
  }
}

/**
 * Walks the days from `p.start`, placing the queue into the capacities `caps` (grain-floored weekday
 * minutes). Stops when the queue is empty, after `horizonDays`, or after day `until` (inclusive).
 */
export function walkSchedule(
  p: PreparedSchedule,
  caps: readonly number[],
  until: number = Number.POSITIVE_INFINITY,
): WalkResult {
  const { grain, maxChunk, horizonDays } = p.opts
  const rem = p.queue.map((u) => u.minutes)
  const placements: Placement[] = []
  const maxCap = Math.max(0, ...caps)
  let unscheduled = p.totalMinutes
  if (maxCap <= 0 || unscheduled === 0) {
    return { placements, unscheduled, noCapacity: maxCap <= 0 }
  }
  const minEff = Math.min(p.opts.minChunk, maxCap)
  const last = Math.min(p.start + horizonDays - 1, until)
  let head = 0

  for (let day = p.start; day <= last && head < rem.length; day++) {
    const weekday = caps[weekdayOfDay(day)] ?? 0
    if (weekday <= 0 || inRanges(day, p.off)) continue
    let cap = floorTo(weekday - (p.reserved.get(day) ?? 0), grain)
    let orderInDay = 0
    let i = head
    while (i < rem.length && cap > 0) {
      const left = rem[i] as number
      if (left <= 0) {
        i++
        continue
      }
      const q = p.queue[i] as QueueUnit
      // On today, skipped minutes are off limits; the rest may only go in full-length pieces.
      const limit = day === p.today && q.deferred > 0 ? left - q.deferred : left
      if (limit <= 0 || (limit < left && limit < minEff)) {
        i++
        continue
      }
      if (cap < minEff && left > cap) break
      let take = Math.min(maxChunk, limit, cap)
      const tail = left - take
      if (tail > 0 && tail < minEff && left - minEff >= minEff) take = left - minEff
      placements.push({ day, q: i, minutes: take, orderInDay: orderInDay++ })
      rem[i] = left - take
      cap -= take
      unscheduled -= take
    }
    while (head < rem.length && (rem[head] as number) <= 0) head++
  }
  return { placements, unscheduled, noCapacity: false }
}

/** Turns a walk into chunks, windows and the projection. */
export function finishSchedule(p: PreparedSchedule, walk: WalkResult): ScheduleResult {
  const { input } = p
  // Chunk numbers per queue unit, in placement (date) order, skipping the ones done/pinned chunks hold.
  const counts = new Array<number>(p.queue.length).fill(0)
  for (const pl of walk.placements) counts[pl.q] = (counts[pl.q] ?? 0) + 1
  const used = p.queue.map(({ unit }) => {
    if (unit.usedSeqs) return new Set(unit.usedSeqs.filter((s) => Number.isInteger(s) && s > 0))
    const n = Math.max(0, Math.floor(unit.chunkSeqStart))
    return new Set(Array.from({ length: n }, (_, i) => i + 1))
  })
  const nextSeq = new Array<number>(p.queue.length).fill(1)

  const chunks: PlannedChunk[] = []
  let totalMinutes = 0
  for (const pl of walk.placements) {
    const q = p.queue[pl.q] as QueueUnit
    const taken = used[pl.q] as Set<number>
    let seq = nextSeq[pl.q] as number
    while (taken.has(seq)) seq++
    nextSeq[pl.q] = seq + 1
    const seqTotal = taken.size + (counts[pl.q] as number)
    totalMinutes += pl.minutes
    chunks.push({
      key: scheduleKey(q.unit.id, seq),
      date: isoOfDay(pl.day),
      minutes: pl.minutes,
      courseId: q.course.id,
      unitId: q.unit.id,
      seq,
      seqTotal,
      title: chunkTitle(q.course, q.unit.title, seq, seqTotal),
      orderInDay: pl.orderInDay,
    })
  }

  // Windows per course, in schedule order, from chunks and pinned work.
  const span = new Map<string, { start: number; end: number; minutes: number }>()
  const widen = (courseId: string, day: number, minutes: number): void => {
    const w = span.get(courseId)
    if (!w) span.set(courseId, { start: day, end: day, minutes })
    else {
      w.start = Math.min(w.start, day)
      w.end = Math.max(w.end, day)
      w.minutes += minutes
    }
  }
  for (const pl of walk.placements)
    widen((p.queue[pl.q] as QueueUnit).course.id, pl.day, pl.minutes)
  for (const pin of p.pins) widen(pin.courseId, pin.day, pin.minutes)
  const seen = new Set<string>()
  const courseOrder: string[] = []
  for (const q of p.queue) {
    if (!seen.has(q.course.id)) {
      seen.add(q.course.id)
      courseOrder.push(q.course.id)
    }
  }
  for (const id of [...span.keys()].sort(cmpStr)) if (!seen.has(id)) courseOrder.push(id)
  const windows: CourseWindow[] = []
  for (const id of courseOrder) {
    const w = span.get(id)
    if (w)
      windows.push({
        courseId: id,
        start: isoOfDay(w.start),
        end: isoOfDay(w.end),
        minutes: w.minutes,
      })
  }

  const issues: SchedulerIssue[] = [...p.topoIssues]
  let blocked = false
  if (walk.unscheduled > 0) {
    blocked = true
    issues.push(
      walk.noCapacity
        ? { code: 'NO_AVAILABILITY' }
        : { code: 'HORIZON_EXCEEDED', unscheduledMinutes: walk.unscheduled },
    )
  }
  const workLeft = p.totalMinutes > 0 || p.pins.length > 0
  if (p.target !== null && p.target < p.today && workLeft) issues.push({ code: 'TARGET_IN_PAST' })

  let projectedEnd: ISODate | null = null
  if (!blocked) {
    const lastChunk = walk.placements.length > 0 ? (walk.placements.at(-1) as Placement).day : null
    const end =
      lastChunk === null
        ? p.pinnedEnd
        : p.pinnedEnd === null
          ? lastChunk
          : Math.max(lastChunk, p.pinnedEnd)
    projectedEnd = end === null ? null : isoOfDay(end)
  }
  const reference = input.targetDate ?? input.baselineEnd
  const slipDays =
    projectedEnd !== null && reference !== null
      ? dayNumber(projectedEnd) - dayNumber(reference)
      : null
  const feasible =
    !blocked && (p.target === null || projectedEnd === null || dayNumber(projectedEnd) <= p.target)

  return { chunks, windows, totalMinutes, projectedEnd, slipDays, feasible, issues }
}

/** Plans the remaining work of one goal. Pure and deterministic: equal input gives deep-equal output. */
export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const p = prepareSchedule(input)
  return finishSchedule(p, walkSchedule(p, p.caps))
}
