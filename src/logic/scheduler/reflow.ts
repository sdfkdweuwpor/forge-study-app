/**
 * Keeping a live plan honest (pure): roll missed work forward, say how far behind the plan is, and
 * "life happened" (re-plan the rest of this week). Nothing here writes; results are previews.
 *
 * Reflow is move-only and push-only. Items keep their keys, lengths and order; an item never moves
 * earlier than its current slot; an item whose slot has passed (a missed one) takes the next open slot
 * at or after the cursor, and later items move only as far as they have to. Per day the flow never goes
 * over max(pace, the longest item), so a paced plan's quiet days absorb missed sessions first.
 * - Reviews and practice tests of an assessment keep their slots; if theirs has passed they take the
 *   nearest free slot before the assessment, or are dropped (reported) when there is none.
 * - Pinned items keep their slots until their day passes (then they flow like any other missed item).
 * - An assessment the user dated stays put; an undated one follows its course's last item.
 *
 * Behind status (thresholds are constants below):
 * - on track: nothing missed and no slip;
 * - slightly behind: something missed or slipped, within the thresholds; the roll-forward may be
 *   applied without asking;
 * - far behind: the end slips more than 7 days past the reference (baseline, else the previous end),
 *   or missed work is more than 15 % of the remaining work, or the end passes the target, or study
 *   lands on or after a dated assessment. Then nothing is applied: the caller shows the proposals.
 */
import type { ISODate } from '@/db/types'
import { dayOf, minutesOfDay } from '../dates'
import { dayNumber, floorTo, isoOfDay } from './capacity'
import { parseScheduleKey } from './estimates'
import { checkFeasibility, formatDuration, withoutUnits } from './feasibility'
import { weeklyMilestones } from './milestones'
import { diffPlanItems } from './planDiff'
import { comparePlanItems, planRun, planStudy, resolvePlannerSettings } from './planner'
import type {
  CurrentPlanItem,
  LivePlanInput,
  PlanChange,
  PlanItem,
  PlannerIssue,
  PlannerSettings,
} from './plannerTypes'
import { busyMapOf, SlotBook } from './slotBook'
import { addMinutesToWindows, formatClock, makeDayIntervals, parseClock, type Interval } from './windows'

export const FAR_BEHIND_SLIP_DAYS = 7
export const FAR_BEHIND_MISSED_SHARE = 0.15

export type BehindLevel = 'onTrack' | 'slightlyBehind' | 'farBehind'
export type BehindReason = 'missedWork' | 'slip' | 'pastTarget' | 'assessmentAtRisk' | 'reviewDropped'

export interface BehindStatus {
  level: BehindLevel
  reasons: BehindReason[]
  missedCount: number
  missedMinutes: number
  /** Open study, review and practice minutes after the roll-forward. */
  remainingMinutes: number
  previousEnd: ISODate | null
  projectedEnd: ISODate | null
  /** What the slip is measured against: the baseline end, else the previous end. */
  reference: ISODate | null
  slipDays: number | null
}

export interface ReflowResult {
  /** The open plan afterwards (milestones recomputed), in plan order. */
  items: PlanItem[]
  change: PlanChange
  previousEnd: ISODate | null
  projectedEnd: ISODate | null
  issues: PlannerIssue[]
}

export type ProposalKind = 'extendDate' | 'addTime' | 'cutScope' | 'spread'

export interface ProposalApply {
  targetDate?: ISODate | null
  baselineEnd?: ISODate | null
  extraMinutesPerStudyDay?: number
  cutUnitIds?: string[]
  paceMinutesPerStudyDay?: number | null
}

/** A choice for a plan that is far behind. Previews only: apply `apply` after the user confirms. */
export interface Proposal {
  kind: ProposalKind
  title: string
  detail: string
  apply: ProposalApply
  change: PlanChange
  items: PlanItem[]
  projectedEnd: ISODate | null
  /** Verified by running the planner with the change. */
  fits: boolean
}

export interface RollForwardResult extends ReflowResult {
  status: BehindStatus
  /** True when the roll-forward may be applied without asking (on track or slightly behind). */
  autoApply: boolean
  /** Empty unless far behind. */
  proposals: Proposal[]
}

// ─── Reflow ─────────────────────────────────────────────────────────────────

interface ReflowOptions {
  fromDay: number
  fromMinute: number
  /** Replaces a day's windows ("life happened"). */
  override?: (day: number, windows: Interval[]) => Interval[]
  /** Days whose kept items (pins, reviews) must still sit inside the windows, or move. */
  recheck?: (day: number) => boolean
}

interface Slot {
  day: number
  start: number | null
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const WORK = new Set(['study', 'review', 'practiceTest'])

function slotOf(c: CurrentPlanItem): Slot {
  return { day: dayNumber(c.doDate), start: c.startTime ? parseClock(c.startTime) : null }
}

function toItem(c: CurrentPlanItem, slot: Slot, minutes = c.durationMinutes): PlanItem {
  const seq = c.kind === 'study' ? (parseScheduleKey(c.key)?.seq ?? null) : null
  return {
    key: c.key,
    kind: c.kind,
    title: c.title,
    courseId: c.courseId,
    unitId: c.unitId,
    assessmentId: c.assessmentId,
    doDate: isoOfDay(slot.day),
    startTime: slot.start === null ? null : formatClock(slot.start),
    durationMinutes: slot.start === null ? 0 : minutes,
    dueDate: c.dueDate,
    seq,
    seqTotal: null,
  }
}

function endOf(items: ReadonlyArray<{ doDate: ISODate; kind: string }>): ISODate | null {
  let end: ISODate | null = null
  for (const i of items) if (i.kind !== 'milestone' && (end === null || i.doDate > end)) end = i.doDate
  return end
}

function reflow(live: LivePlanInput, o: ReflowOptions): ReflowResult {
  const s: PlannerSettings = resolvePlannerSettings(live.settings)
  const base = makeDayIntervals(live.availability)
  const dayIntervals = o.override ? (d: number) => (o.override as NonNullable<ReflowOptions['override']>)(d, base(d)) : base
  const book = new SlotBook({
    dayIntervals,
    busy: busyMapOf(live.blockedSlots),
    startDay: o.fromDay,
    startMinute: o.fromMinute,
    grain: s.grain,
  })
  const dated = new Map((live.assessments ?? []).filter((a) => a.date !== null && !a.done).map((a) => [a.id, a]))
  const undated = new Set((live.assessments ?? []).filter((a) => a.date === null).map((a) => a.id))
  const passed = (sl: Slot): boolean =>
    sl.day < o.fromDay || (sl.day === o.fromDay && sl.start !== null && sl.start < o.fromMinute)
  const inside = (sl: Slot, minutes: number): boolean =>
    sl.start !== null &&
    dayIntervals(sl.day).some(([a, b]) => (sl.start as number) >= a && (sl.start as number) + minutes <= b)
  const recheck = (sl: Slot, minutes: number): boolean => !!o.recheck?.(sl.day) && !inside(sl, minutes)

  const out: PlanItem[] = []
  const flow: CurrentPlanItem[] = []
  const anchored: CurrentPlanItem[] = []
  const followers: CurrentPlanItem[] = []
  const removedNoSlot: string[] = []

  for (const c of live.current) {
    const sl = slotOf(c)
    if (c.status === 'done') {
      if (sl.start !== null && sl.day >= o.fromDay) book.reserve(sl.day, sl.start, sl.start + c.durationMinutes)
      continue
    }
    if (c.kind === 'milestone') continue
    const keepHere = (): void => {
      if (sl.start !== null && c.durationMinutes > 0) book.reserve(sl.day, sl.start, sl.start + c.durationMinutes)
      out.push(toItem(c, sl))
    }
    if (c.kind === 'assessment') {
      if (c.assessmentId !== null && undated.has(c.assessmentId)) followers.push(c)
      else keepHere()
    } else if ((c.kind === 'review' || c.kind === 'practiceTest') && c.assessmentId !== null) {
      if (passed(sl) || recheck(sl, c.durationMinutes)) anchored.push(c)
      else keepHere()
    } else if (c.pinned && !passed(sl) && !recheck(sl, c.durationMinutes)) keepHere()
    else flow.push(c)
  }

  // Reviews and practice tests whose slot passed: nearest free slot before their assessment.
  const horizon = o.fromDay + s.horizonDays - 1
  for (const c of anchored.sort((a, b) => cmpStr(a.doDate, b.doDate) || cmpStr(a.key, b.key))) {
    const want = Math.max(o.fromDay, dayNumber(c.doDate))
    const hi = c.dueDate ? dayNumber(c.dueDate) - 1 : horizon
    let spot: Slot | null = null
    for (let d = want; d >= o.fromDay && !spot; d--) {
      const at = book.firstFit(d, 0, c.durationMinutes)
      if (at !== null) spot = { day: d, start: at }
    }
    for (let d = want + 1; d <= hi && !spot; d++) {
      const at = book.firstFit(d, 0, c.durationMinutes)
      if (at !== null) spot = { day: d, start: at }
    }
    if (!spot || spot.day > hi) {
      removedNoSlot.push(c.key)
      continue
    }
    book.reserve(spot.day, spot.start as number, (spot.start as number) + c.durationMinutes)
    out.push(toItem(c, spot))
  }

  // The flow, in its current order, push-only.
  const issues: PlannerIssue[] = []
  const maxFlow = Math.max(0, ...flow.map((c) => c.durationMinutes))
  const pace = live.paceMinutesPerStudyDay
  const cap = pace === null || pace === undefined ? Number.POSITIVE_INFINITY : Math.max(pace, maxFlow)
  const used = new Map<number, number>()
  const lastOfCourse = new Map<string | null, number>()
  const st = { day: o.fromDay, min: o.fromMinute, busy: false }
  const ordered = [...flow].sort(
    (a, b) => cmpStr(a.doDate, b.doDate) || cmpStr(a.startTime ?? '', b.startTime ?? '') || cmpStr(a.key, b.key),
  )
  let failed = false
  for (const c of ordered) {
    const own = slotOf(c)
    const m = c.durationMinutes
    if (failed || m <= 0) {
      out.push(toItem(c, own))
      continue
    }
    // Where it may start: the cursor, or its own slot if that is later and has not passed.
    let tDay = st.day
    let tMin = st.min
    if (!passed(own) && (own.day > tDay || (own.day === tDay && (own.start ?? 0) > tMin))) {
      tDay = own.day
      tMin = own.start ?? 0
    }
    let spot: Slot | null = null
    for (let d = tDay; d <= horizon; d++) {
      if ((used.get(d) ?? 0) + m > cap) continue
      const floor = d === tDay ? tMin : 0
      const brk = d === st.day && st.busy ? s.breakMinutes : 0
      const lo = d === st.day ? Math.max(floor, st.min + brk) : floor
      const at = book.firstFit(d, lo, m) ?? (brk > 0 && d === st.day ? book.firstFit(d, Math.max(floor, st.min), m) : null)
      if (at !== null) {
        spot = { day: d, start: at }
        break
      }
    }
    if (!spot || spot.start === null) {
      failed = true
      issues.push({ code: 'HORIZON_EXCEEDED', unscheduledMinutes: m })
      out.push(toItem(c, own))
      continue
    }
    book.reserve(spot.day, spot.start, spot.start + m)
    used.set(spot.day, (used.get(spot.day) ?? 0) + m)
    if (spot.day !== st.day) st.busy = false
    st.day = spot.day
    st.min = spot.start + m
    st.busy = true
    lastOfCourse.set(c.courseId, Math.max(lastOfCourse.get(c.courseId) ?? spot.day, spot.day))
    out.push(toItem(c, spot))
  }

  // Undated assessments follow their course's work.
  for (const c of followers) {
    const own = slotOf(c)
    const last = lastOfCourse.get(c.courseId)
    let day = passed(own) ? o.fromDay : own.day
    if (last !== undefined && last >= day) day = last + 1
    while (day <= horizon && dayIntervals(day).length === 0) day++
    let start: number | null = null
    if (own.start !== null && c.durationMinutes > 0) {
      const keep = day === own.day && !passed(own) && book.firstFit(day, own.start, c.durationMinutes) === own.start
      start = keep ? own.start : book.firstFit(day, 0, c.durationMinutes)
      if (start !== null) book.reserve(day, start, start + c.durationMinutes)
    }
    out.push(toItem(c, { day, start }))
  }

  // Study planned on or after a dated assessment of its course.
  for (const a of dated.values()) {
    const d = dayNumber(a.date as ISODate)
    if (d < o.fromDay) continue
    const late = out.find((i) => i.kind === 'study' && (a.courseId === null || i.courseId === a.courseId) && i.doDate >= (a.date as ISODate))
    if (late) issues.push({ code: 'ASSESSMENT_TOO_EARLY', assessmentId: a.id, lastStudyDate: late.doDate })
  }

  const items = [...out, ...weeklyMilestones(out, live.courses, s.weekStartsOn)].sort(comparePlanItems)
  const change = diffPlanItems(live.current, items)
  const noSlot = new Set(removedNoSlot)
  change.removed = change.removed.map((r) => (noSlot.has(r.key) ? { ...r, reason: 'noSlotBeforeAssessment' as const } : r))
  const datedEnds = [...dated.values()]
    .map((a) => a.date as ISODate)
    .filter((d) => d >= live.today)
  const withDates = (xs: ReadonlyArray<{ doDate: ISODate; kind: string }>): ISODate | null => {
    const e = endOf(xs)
    return [e, ...datedEnds].reduce<ISODate | null>((m, d) => (d !== null && (m === null || d > m) ? d : m), null)
  }
  return {
    items,
    change,
    previousEnd: withDates(live.current.filter((c) => c.status === 'open')),
    projectedEnd: withDates(items),
    issues,
  }
}

// ─── Status and proposals ───────────────────────────────────────────────────

function statusOf(live: LivePlanInput, r: ReflowResult, fromDay: number, fromMinute: number): BehindStatus {
  let missedCount = 0
  let missedMinutes = 0
  for (const c of live.current) {
    if (c.status !== 'open' || !WORK.has(c.kind)) continue
    const sl = slotOf(c)
    if (sl.day < fromDay || (sl.day === fromDay && sl.start !== null && sl.start < fromMinute)) {
      missedCount++
      missedMinutes += c.durationMinutes
    }
  }
  const remainingMinutes = r.items.filter((i) => WORK.has(i.kind)).reduce((n, i) => n + i.durationMinutes, 0)
  const reference = live.baselineEnd ?? r.previousEnd
  const slipDays =
    r.projectedEnd !== null && reference !== null ? dayNumber(r.projectedEnd) - dayNumber(reference) : null
  const reasons: BehindReason[] = []
  if (missedCount > 0) reasons.push('missedWork')
  if (slipDays !== null && slipDays > 0) reasons.push('slip')
  const pastTarget = live.targetDate !== null && r.projectedEnd !== null && r.projectedEnd > live.targetDate
  if (pastTarget) reasons.push('pastTarget')
  const atRisk = r.issues.some((i) => i.code === 'ASSESSMENT_TOO_EARLY')
  if (atRisk) reasons.push('assessmentAtRisk')
  if (r.change.removed.some((x) => x.reason === 'noSlotBeforeAssessment')) reasons.push('reviewDropped')
  const far =
    (slipDays !== null && slipDays > FAR_BEHIND_SLIP_DAYS) ||
    missedMinutes > FAR_BEHIND_MISSED_SHARE * remainingMinutes ||
    pastTarget ||
    atRisk
  const behind = missedCount > 0 || (slipDays !== null && slipDays > 0) || reasons.includes('reviewDropped')
  return {
    level: far ? 'farBehind' : behind ? 'slightlyBehind' : 'onTrack',
    reasons,
    missedCount,
    missedMinutes,
    remainingMinutes,
    previousEnd: r.previousEnd,
    projectedEnd: r.projectedEnd,
    reference,
    slipDays,
  }
}

function shortDay(d: ISODate): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[Number(d.slice(5, 7)) - 1] ?? ''} ${Number(d.slice(8, 10))}`
}

/**
 * The choices for a plan that is far behind, each previewed against the stored plan and verified by
 * running the planner: move the date, add time, cut scope, spread the remaining work.
 */
export function behindProposals(live: LivePlanInput, rolled: ReflowResult): Proposal[] {
  const out: Proposal[] = []
  const ref = live.targetDate ?? live.baselineEnd ?? null
  const withTarget = (extra: Partial<LivePlanInput> = {}) => ({ ...live, ...extra })

  // 1. Move the date (with a target), or accept the new end (ASAP).
  if (live.targetDate !== null) {
    const run = planRun({ ...live, targetDate: null }, live.paceMinutesPerStudyDay)
    let d = run.bufferedEnd === null ? null : isoOfDay(run.bufferedEnd)
    let res = d === null ? null : planStudy(withTarget({ targetDate: d }))
    for (let i = 0; i < 14 && d !== null && res !== null && !res.fits; i++) {
      d = isoOfDay(dayNumber(d) + 1)
      res = planStudy(withTarget({ targetDate: d }))
    }
    if (d !== null && res !== null && res.fits)
      out.push({
        kind: 'extendDate',
        title: `Move the finish date to ${shortDay(d)}`,
        detail: 'Keep your pace and give the plan more days.',
        apply: { targetDate: d },
        change: diffPlanItems(live.current, res.items),
        items: res.items,
        projectedEnd: res.projectedEnd,
        fits: true,
      })
  } else if (rolled.projectedEnd !== null) {
    out.push({
      kind: 'extendDate',
      title: `Accept the new finish date, ${shortDay(rolled.projectedEnd)}`,
      detail: 'Keep your pace; the remaining work moves forward.',
      apply: { baselineEnd: rolled.projectedEnd },
      change: rolled.change,
      items: rolled.items,
      projectedEnd: rolled.projectedEnd,
      fits: true,
    })
  }
  if (ref === null) return out

  // 2 and 3. Add time, cut scope (verified inside checkFeasibility).
  const f = checkFeasibility(live, ref)
  const extra = f.options.addTime.extraMinutesPerStudyDay
  if (!f.fits && extra !== null && extra > 0) {
    const res = planStudy({ ...live, targetDate: ref, availability: addMinutesToWindows(live.availability, extra) })
    out.push({
      kind: 'addTime',
      title: `Add ${formatDuration(extra)} to each study day`,
      detail: `Finish by ${shortDay(ref)} with a little more time each study day.`,
      apply: { extraMinutesPerStudyDay: extra },
      change: diffPlanItems(live.current, res.items),
      items: res.items,
      projectedEnd: res.projectedEnd,
      fits: res.fits,
    })
  }
  const cut = f.options.cutScope.suggestedCut
  if (!f.fits && cut.length > 0) {
    const res = planStudy({ ...withoutUnits(live, cut), targetDate: ref })
    out.push({
      kind: 'cutScope',
      title: `Cut ${cut.length} ${cut.length === 1 ? 'unit' : 'units'} (${formatDuration(f.options.cutScope.cutMinutes)})`,
      detail: 'Skip what you already know or what is optional.',
      apply: { cutUnitIds: cut },
      change: diffPlanItems(live.current, res.items, new Set(cut)),
      items: res.items,
      projectedEnd: res.projectedEnd,
      fits: res.fits,
    })
  }

  // 4. Spread: re-pace the remaining work over the days left (only a paced plan has room to).
  if (live.paceMinutesPerStudyDay !== null) {
    const res = planStudy({ ...live, targetDate: ref })
    const pace = res.pace.minutesPerStudyDay
    if (res.fits && pace !== null && pace !== live.paceMinutesPerStudyDay)
      out.push({
        kind: 'spread',
        title: `Spread the rest: about ${formatDuration(pace)} per study day`,
        detail: `Use more of your study windows to still finish by ${shortDay(ref)}.`,
        apply: { paceMinutesPerStudyDay: pace, targetDate: live.targetDate },
        change: diffPlanItems(live.current, res.items),
        items: res.items,
        projectedEnd: res.projectedEnd,
        fits: true,
      })
  }
  return out
}

function nowMinuteOn(live: LivePlanInput, day: number): number {
  if (live.now === undefined || live.now === null) return 0
  return dayOf(live.now) === isoOfDay(day) ? minutesOfDay(live.now) : 0
}

/**
 * Missed work (slot before today, or before `now` when given) moves to the next open slots and the
 * projected end updates. Apply it without asking only when `autoApply`; when far behind the result
 * carries proposals instead and nothing should change until the user picks one.
 */
export function rollForward(live: LivePlanInput): RollForwardResult {
  const fromDay = dayNumber(live.today)
  const fromMinute = nowMinuteOn(live, fromDay)
  const r = reflow(live, { fromDay, fromMinute })
  const status = statusOf(live, r, fromDay, fromMinute)
  const far = status.level === 'farBehind'
  return { ...r, status, autoApply: !far, proposals: far ? behindProposals(live, r) : [] }
}

/** How far behind the live plan is (the roll-forward's status, without proposals). */
export function behindStatus(live: LivePlanInput): BehindStatus {
  const fromDay = dayNumber(live.today)
  const fromMinute = nowMinuteOn(live, fromDay)
  return statusOf(live, reflow(live, { fromDay, fromMinute }), fromDay, fromMinute)
}

export interface ReplanWeekOptions {
  /** First day of the week to re-plan. */
  weekStart: ISODate
  today: ISODate
  /** Days with no study at all this week. */
  blockedDays?: readonly ISODate[]
  /**
   * Share of each remaining day's windows still usable (0–1). Default 0 (clear the rest of the week)
   * unless `blockedDays` are given, then 1 (only those days are cleared).
   */
  capacityFactor?: number
}

export interface WeekProposal extends ReflowResult {
  weekStart: ISODate
  weekEnd: ISODate
  status: BehindStatus
}

/**
 * "Life happened": the rest of this week gets less (or no) study time and its work moves later, pushing
 * later work only as far as needed. A proposal: nothing is applied until the user confirms.
 */
export function replanWeek(live: LivePlanInput, opts: ReplanWeekOptions): WeekProposal {
  const s = resolvePlannerSettings(live.settings)
  const ws = dayNumber(opts.weekStart)
  const we = ws + 6
  const today = dayNumber(opts.today)
  const from = Math.max(today, ws)
  const input = { ...live, today: opts.today }
  const fromMinute = from === today ? nowMinuteOn(input, from) : 0
  const blocked = new Set((opts.blockedDays ?? []).map(dayNumber))
  const factor = Math.min(1, Math.max(0, opts.capacityFactor ?? (blocked.size > 0 ? 1 : 0)))
  const inWeek = (d: number): boolean => d >= from && d <= we
  const override = (d: number, xs: Interval[]): Interval[] => {
    if (!inWeek(d)) return xs
    if (blocked.has(d)) return []
    return xs
      .map(([a, b]): Interval => [a, a + floorTo((b - a) * factor, s.grain)])
      .filter(([a, b]) => b > a)
  }
  const r = reflow(input, { fromDay: from, fromMinute, override, recheck: inWeek })
  return {
    ...r,
    weekStart: isoOfDay(ws),
    weekEnd: isoOfDay(we),
    status: statusOf(input, r, from, fromMinute),
  }
}
