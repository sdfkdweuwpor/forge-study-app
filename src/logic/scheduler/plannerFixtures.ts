/**
 * Test builders and an independent invariant checker for the slot planner. Not used by the app. The
 * checker reads windows straight from the input with `@/logic/dates` (date-fns), not through the
 * planner's own day arithmetic.
 */
import type { HHmm, ISODate } from '@/db/types'
import { isInAnyRange, weekdayOf } from '../dates'
import { dayNumber } from './capacity'
import type {
  AvailabilityV2,
  BusyBlock,
  CurrentPlanItem,
  DayWindows,
  PinnedPlanItem,
  PlanItem,
  PlannerCourse,
  PlannerInput,
  PlannerResult,
  PlannerUnit,
  WeekWindows,
} from './plannerTypes'
import { wguYearPlan } from './fixtures'
import { fromLegacyAvailability, parseClock } from './windows'

/** Monday 2026-10-05. */
export const MON: ISODate = '2026-10-05'

export function win(...pairs: ReadonlyArray<readonly [HHmm, HHmm]>): DayWindows {
  return pairs.map(([start, end]) => ({ start, end }))
}

/** Weekday windows, Sunday first, from a Monday–Friday value plus Saturday and Sunday. */
export function weekWin(monFri: DayWindows, sat: DayWindows = [], sun: DayWindows = []): WeekWindows {
  return [sun, monFri, monFri, monFri, monFri, monFri, sat]
}

export function avail2(weekly: WeekWindows, extra: Partial<AvailabilityV2> = {}): AvailabilityV2 {
  return { weekly, sessionMinutes: 50, blackouts: [], shiftPattern: null, ...extra }
}

export function punit(id: string, minutes: number, extra: Partial<PlannerUnit> = {}): PlannerUnit {
  return { id, title: `Topic ${id}`, order: 0, remainingMinutes: minutes, ...extra }
}

/** A course whose units are minutes (ids `${id}-u1`, …, titled "Topic n") or units. */
export function pcourse(
  id: string,
  units: ReadonlyArray<number | PlannerUnit>,
  extra: Partial<Omit<PlannerCourse, 'units'>> = {},
): PlannerCourse {
  return {
    id,
    code: id.toUpperCase(),
    title: `Course ${id}`,
    order: 0,
    status: 'todo',
    prerequisiteIds: [],
    ...extra,
    units: units.map((u, i) =>
      typeof u === 'number' ? punit(`${id}-u${i + 1}`, u, { order: i, title: `Topic ${i + 1}` }) : u,
    ),
  }
}

/** Evenings Mon–Fri 18:00–20:00, no buffer (tests add one when they need it). */
export function pinput(partial: Partial<PlannerInput> & Pick<PlannerInput, 'courses'>): PlannerInput {
  return {
    today: MON,
    targetDate: null,
    availability: avail2(weekWin(win(['18:00', '20:00']))),
    ...partial,
    settings: { bufferPct: 0, ...partial.settings },
  }
}

const minutesOf = (t: HHmm): number => parseClock(t) ?? Number.NaN

/** Windows the input allows on `date`, computed independently of the planner (no DST handling). */
function allowed(inp: PlannerInput, date: ISODate): Array<[number, number]> {
  const av = inp.availability
  if (isInAnyRange(date, av.blackouts)) return []
  let ws: DayWindows | null | undefined
  const p = av.shiftPattern
  if (p && p.cycle.length > 0) {
    const n = p.cycle.length
    const idx = (((dayNumber(date) - dayNumber(p.anchor)) % n) + n) % n
    ws = p.cycle[idx]
  } else ws = av.weekly[weekdayOf(date)]
  return (ws ?? []).map((w) => [minutesOf(w.start), minutesOf(w.end)])
}

interface Block {
  date: ISODate
  start: number
  end: number
  what: string
}

function blocksOf(busy: readonly BusyBlock[], pinned: readonly PinnedPlanItem[]): Block[] {
  const out: Block[] = []
  for (const b of busy)
    out.push({ date: b.date, start: minutesOf(b.start), end: minutesOf(b.start) + b.durationMinutes, what: `busy ${b.id ?? ''}` })
  for (const p of pinned)
    if (p.startTime)
      out.push({ date: p.date, start: minutesOf(p.startTime), end: minutesOf(p.startTime) + p.durationMinutes, what: `pin ${p.key}` })
  return out
}

/**
 * Rules every plan must satisfy, as human-readable violations (empty when all hold): timed items lie
 * inside one window of their day, never overlap each other, busy blocks or timed pins, start on or
 * after today (and `now`); keys are unique; sessions of a unit run in `seq` order; study follows the
 * course order given; reviews and practice tests come before their assessment.
 */
export function checkPlan(inp: PlannerInput, res: PlannerResult, courseOrder?: readonly string[]): string[] {
  const out: string[] = []
  const timed = res.items.filter((i) => i.startTime !== null && i.durationMinutes > 0)
  const keys = new Set<string>()
  for (const i of res.items) {
    if (keys.has(i.key)) out.push(`duplicate key ${i.key}`)
    keys.add(i.key)
    if (i.doDate < inp.today) out.push(`${i.key} before today`)
  }
  const blocks = blocksOf(inp.blockedSlots ?? [], inp.pinned ?? [])
  for (const i of timed) {
    const s = minutesOf(i.startTime as HHmm)
    const e = s + i.durationMinutes
    const b = { date: i.doDate, start: s, end: e, what: i.key }
    const fixed = i.kind === 'assessment' && (inp.assessments ?? []).some((a) => a.id === i.assessmentId && a.time)
    if (!fixed && !allowed(inp, i.doDate).some(([a, z]) => s >= a && e <= z))
      out.push(`${i.key} ${i.doDate} ${i.startTime}+${i.durationMinutes} is outside the windows`)
    blocks.push(b)
  }
  const byDay = new Map<ISODate, Block[]>()
  for (const b of blocks) byDay.set(b.date, [...(byDay.get(b.date) ?? []), b])
  for (const [date, list] of byDay) {
    list.sort((x, y) => x.start - y.start)
    for (let k = 1; k < list.length; k++) {
      const a = list[k - 1] as Block
      const b = list[k] as Block
      if (b.start < a.end) out.push(`${date}: ${a.what} overlaps ${b.what}`)
    }
  }
  const at = (i: PlanItem): string => `${i.doDate} ${i.startTime ?? '99:99'}`
  const lastSeq = new Map<string, { seq: number; at: string }>()
  for (const i of [...res.items].sort((x, y) => (at(x) < at(y) ? -1 : at(x) > at(y) ? 1 : 0))) {
    if (i.kind !== 'study' || i.unitId === null || i.seq === null) continue
    const prev = lastSeq.get(i.unitId)
    if (prev && prev.seq > i.seq) out.push(`${i.key} comes after seq ${prev.seq}`)
    lastSeq.set(i.unitId, { seq: i.seq, at: at(i) })
  }
  if (courseOrder) {
    const study = res.items.filter((i) => i.kind === 'study')
    for (let k = 1; k < courseOrder.length; k++) {
      const prevLast = study.filter((i) => i.courseId === courseOrder[k - 1]).map(at).sort().at(-1)
      const nextFirst = study.filter((i) => i.courseId === courseOrder[k]).map(at).sort()[0]
      if (prevLast && nextFirst && nextFirst < prevLast)
        out.push(`${courseOrder[k]} starts before ${courseOrder[k - 1]} ends`)
    }
  }
  const assessmentDay = new Map(res.items.filter((i) => i.kind === 'assessment').map((i) => [i.assessmentId, i.doDate]))
  for (const i of res.items) {
    if ((i.kind === 'review' || i.kind === 'practiceTest') && i.assessmentId) {
      const d = assessmentDay.get(i.assessmentId)
      if (d && i.doDate >= d) out.push(`${i.key} on ${i.doDate} is not before its assessment on ${d}`)
    }
  }
  return out
}

/** The plan's items as stored tasks (all open unless listed as done). */
export function asCurrent(items: readonly PlanItem[], done: readonly string[] = []): CurrentPlanItem[] {
  return items
    .filter((i) => i.kind !== 'milestone')
    .map((i) => ({
      key: i.key,
      kind: i.kind,
      title: i.title,
      courseId: i.courseId,
      unitId: i.unitId,
      assessmentId: i.assessmentId,
      doDate: i.doDate,
      startTime: i.startTime,
      durationMinutes: i.durationMinutes,
      dueDate: i.dueDate,
      status: done.includes(i.key) ? ('done' as const) : ('open' as const),
    }))
}

/** `[date, start, key, minutes]` rows for compact assertions. */
export const rows = (items: readonly PlanItem[]) =>
  items.filter((i) => i.kind !== 'milestone').map((i) => [i.doDate, i.startTime, i.key, i.durationMinutes])

/**
 * The 12-course WGU year from `fixtures.ts` as planner input: legacy minutes per weekday mapped to
 * evening windows, one undated objective assessment per course, a dated one for the first course.
 */
export function wguPlannerInput(): PlannerInput {
  const legacy = wguYearPlan()
  return {
    today: legacy.today,
    targetDate: legacy.targetDate,
    availability: fromLegacyAvailability(legacy.availability, { studyStart: '18:00' }),
    courses: legacy.courses,
    assessments: legacy.courses.map((c, i) => ({
      id: `oa-${c.id}`,
      courseId: c.id,
      kind: 'exam' as const,
      title: 'Objective assessment',
      date: i === 0 ? '2026-11-20' : null,
    })),
  }
}

/** A tiny seeded PRNG (mulberry32) for property tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
