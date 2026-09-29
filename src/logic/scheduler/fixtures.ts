/**
 * Test builders and an invariant checker for the scheduler. Not used by the app. The checker walks
 * days with `@/logic/dates` (date-fns), independently of the scheduler's own day arithmetic.
 */
import type {
  Availability,
  DateRange,
  Goal,
  ID,
  ISODate,
  Milestone,
  Task,
  Unit,
  WeekMinutes,
} from '@/db/types'
import { eachDay, isInAnyRange, weekdayOf } from '../dates'
import { ceilTo, floorTo, resolveOptions } from './capacity'
import { chunkFields } from './diff'
import type {
  CourseStatus,
  PinnedWork,
  PlannedChunk,
  SchedCourse,
  ScheduleDiff,
  ScheduleInput,
  ScheduleResult,
  SchedUnit,
} from './types'

/** Monday 2026-10-05. */
export const MONDAY: ISODate = '2026-10-05'

/** Minutes per weekday, Sunday first, from a Monday–Friday value plus Saturday and Sunday. */
export function week(monFri: number, sat = 0, sun = 0): WeekMinutes {
  return [sun, monFri, monFri, monFri, monFri, monFri, sat]
}

export function avail(minutesByWeekday: WeekMinutes, daysOff: DateRange[] = []): Availability {
  return { minutesByWeekday, daysOff }
}

export function unit(id: string, minutes: number, extra: Partial<SchedUnit> = {}): SchedUnit {
  return {
    id,
    title: `Unit ${id}`,
    order: 0,
    remainingMinutes: minutes,
    chunkSeqStart: 0,
    ...extra,
  }
}

/** A course whose units are given as minutes (ids `${id}-u1`, …) or as units. */
export function course(
  id: string,
  units: ReadonlyArray<number | SchedUnit>,
  extra: Partial<Omit<SchedCourse, 'units'>> & { status?: CourseStatus } = {},
): SchedCourse {
  return {
    id,
    code: id.toUpperCase(),
    title: `Course ${id}`,
    order: 0,
    status: 'todo',
    prerequisiteIds: [],
    ...extra,
    units: units.map((u, i) =>
      typeof u === 'number' ? unit(`${id}-u${i + 1}`, u, { order: i, title: `Topic ${i + 1}` }) : u,
    ),
  }
}

export function input(
  partial: Partial<ScheduleInput> & Pick<ScheduleInput, 'courses'>,
): ScheduleInput {
  return {
    today: MONDAY,
    targetDate: null,
    baselineEnd: null,
    availability: avail(week(60)),
    reservedMinutes: {},
    ...partial,
  }
}

const sumBy = <T>(xs: readonly T[], f: (x: T) => number): number => xs.reduce((s, x) => s + f(x), 0)

/**
 * Every rule of PLAN §4.2 the result must satisfy, as a list of human-readable violations (empty when
 * all hold): per-day capacity, chunk bounds (only a unit's last chunk may be under minEff), grain,
 * start date, unique keys, orderInDay, sort order, and conservation of minutes.
 */
export function checkInvariants(inp: ScheduleInput, res: ScheduleResult): string[] {
  const out: string[] = []
  const opts = resolveOptions(inp.options)
  const caps = inp.availability.minutesByWeekday.map((m) => (m > 0 ? floorTo(m, opts.grain) : 0))
  const minEff = Math.min(opts.minChunk, Math.max(0, ...caps))
  const start = inp.startDate && inp.startDate > inp.today ? inp.startDate : inp.today
  const pinnedOn = new Map<ISODate, number>()
  for (const p of inp.pinned ?? []) pinnedOn.set(p.date, (pinnedOn.get(p.date) ?? 0) + p.minutes)

  const byDate = new Map<ISODate, PlannedChunk[]>()
  for (const c of res.chunks) {
    const list = byDate.get(c.date) ?? []
    list.push(c)
    byDate.set(c.date, list)
  }
  for (const [date, list] of byDate) {
    if (date < start) out.push(`${date}: chunk before the start ${start}`)
    const weekday = caps[weekdayOf(date)] ?? 0
    const off = isInAnyRange(date, inp.availability.daysOff)
    const used = (inp.reservedMinutes[date] ?? 0) + (pinnedOn.get(date) ?? 0)
    const cap = off || weekday <= 0 ? 0 : Math.max(0, floorTo(weekday - used, opts.grain))
    const sum = sumBy(list, (c) => c.minutes)
    if (sum > cap) out.push(`${date}: ${sum} min placed on a ${cap}-min day`)
    list.forEach((c, i) => {
      if (c.orderInDay !== i) out.push(`${c.key}: orderInDay ${c.orderInDay}, expected ${i}`)
    })
  }

  for (let i = 1; i < res.chunks.length; i++) {
    const a = res.chunks[i - 1] as PlannedChunk
    const b = res.chunks[i] as PlannedChunk
    if (a.date > b.date || (a.date === b.date && a.orderInDay >= b.orderInDay))
      out.push(`chunks out of order at ${b.key}`)
  }

  const keys = new Set<string>()
  const lastOfUnit = new Map<string, PlannedChunk>()
  for (const c of res.chunks) {
    if (keys.has(c.key)) out.push(`duplicate key ${c.key}`)
    keys.add(c.key)
    if (c.key !== `${c.unitId}:${c.seq}`) out.push(`${c.key}: key does not match unit and seq`)
    if (c.seq < 1 || c.seq > c.seqTotal) out.push(`${c.key}: seq ${c.seq} of ${c.seqTotal}`)
    if (c.minutes % opts.grain !== 0) out.push(`${c.key}: ${c.minutes} min is off the grain`)
    if (c.minutes <= 0 || c.minutes > opts.maxChunk)
      out.push(`${c.key}: ${c.minutes} min out of range`)
    lastOfUnit.set(c.unitId, c)
  }
  for (const c of res.chunks) {
    if (c.minutes < minEff && lastOfUnit.get(c.unitId) !== c)
      out.push(`${c.key}: ${c.minutes} min is under ${minEff} and not the unit's last chunk`)
  }

  const blocked = res.issues.some(
    (i) => i.code === 'NO_AVAILABILITY' || i.code === 'HORIZON_EXCEEDED',
  )
  if (!blocked) {
    for (const co of inp.courses) {
      if (co.status === 'done') {
        if (res.chunks.some((c) => c.courseId === co.id))
          out.push(`${co.id}: done course scheduled`)
        continue
      }
      for (const u of co.units) {
        const want = u.remainingMinutes > 0 ? ceilTo(u.remainingMinutes, opts.grain) : 0
        const got = sumBy(
          res.chunks.filter((c) => c.unitId === u.id),
          (c) => c.minutes,
        )
        if (want !== got) out.push(`${u.id}: ${got} min placed, ${want} remaining`)
      }
    }
  }
  if (res.totalMinutes !== sumBy(res.chunks, (c) => c.minutes)) out.push('totalMinutes mismatch')
  return out
}

/** Every day from the first to the last chunk, for gap checks. */
export function chunkDays(res: ScheduleResult): ISODate[] {
  const first = res.chunks[0]?.date
  const last = res.chunks.at(-1)?.date
  return first && last ? eachDay(first, last) : []
}

const WGU_CODES = [
  ['C182', 'Introduction to IT', 40],
  ['C779', 'Web Development Foundations', 30],
  ['D278', 'Scripting and Programming Foundations', 45],
  ['C172', 'Network and Security Foundations', 50],
  ['C959', 'Discrete Mathematics I', 45],
  ['C867', 'Scripting and Programming Applications', 40],
  ['C949', 'Data Structures and Algorithms I', 45],
  ['D197', 'Version Control', 15],
  ['C458', 'Health, Fitness, and Wellness', 30],
  ['C173', 'Scripting and Programming Foundations', 35],
  ['D426', 'Data Management Foundations', 40],
  ['C175', 'Data Management', 35],
] as const

/**
 * A realistic year: 12 WGU courses (450 h in 6–8 units each), a prerequisite chain, 10 h a week of
 * study (lighter Sunday and Friday, long Saturday), two vacations, a pinned session and a target date.
 */
export function wguYearPlan(today: ISODate = '2026-09-29'): ScheduleInput {
  const courses: SchedCourse[] = WGU_CODES.map(([code, title, hours], i) => {
    const n = 6 + (i % 3)
    const per = Math.floor((hours * 60) / n / 5) * 5
    const units: SchedUnit[] = Array.from({ length: n }, (_, k) =>
      unit(`${code.toLowerCase()}-u${k + 1}`, k === n - 1 ? hours * 60 - per * (n - 1) : per, {
        order: k,
        title: `Unit ${k + 1}`,
      }),
    )
    return {
      id: `course-${code.toLowerCase()}`,
      code,
      title,
      order: i,
      status: i === 0 ? 'active' : 'todo',
      prerequisiteIds: i === 5 ? ['course-d278'] : i === 6 ? ['course-c867'] : [],
      units,
    }
  })
  const pinned: PinnedWork[] = [{ date: '2026-10-03', minutes: 60, courseId: 'course-c182' }]
  return {
    today,
    targetDate: '2027-10-31',
    baselineEnd: null,
    courses,
    availability: avail(
      [60, 90, 90, 90, 90, 60, 120],
      [
        { start: '2026-11-25', end: '2026-11-29', label: 'Thanksgiving' },
        { start: '2026-12-21', end: '2027-01-01', label: 'Holidays' },
      ],
    ),
    reservedMinutes: {},
    pinned,
  }
}

// ─── Rows (for planGoal and diff tests) ─────────────────────────────────────

export const GOAL_ID: ID = 'goal-1'
const T0 = 1_700_000_000_000

export function goalRow(extra: Partial<Goal> = {}): Goal {
  return {
    id: GOAL_ID,
    createdAt: T0,
    updatedAt: T0,
    title: 'Test goal',
    icon: '🎯',
    cover: null,
    kind: 'degree',
    status: 'active',
    startDate: '2026-09-01',
    targetDate: null,
    availability: avail(week(60)),
    terms: [],
    notes: [],
    order: 0,
    baselineEnd: null,
    projection: null,
    lastRebalancedOn: null,
    completedAt: null,
    ...extra,
  }
}

export function milestoneRow(id: ID, extra: Partial<Milestone> = {}): Milestone {
  return {
    id,
    createdAt: T0,
    updatedAt: T0,
    goalId: GOAL_ID,
    kind: 'course',
    code: id.toUpperCase(),
    title: `Course ${id}`,
    icon: null,
    cover: null,
    status: 'todo',
    order: 0,
    prerequisiteIds: [],
    estimateHours: 0,
    dueDate: null,
    cus: null,
    courseType: null,
    termId: null,
    notes: [],
    projectedStart: null,
    projectedEnd: null,
    completedAt: null,
    ...extra,
  }
}

export function unitRow(
  id: ID,
  milestoneId: ID,
  minutes: number | null,
  extra: Partial<Unit> = {},
): Unit {
  return {
    id,
    createdAt: T0,
    updatedAt: T0,
    goalId: GOAL_ID,
    milestoneId,
    title: `Topic ${id}`,
    order: 0,
    estimateMinutes: minutes,
    difficulty: 1,
    status: 'todo',
    completedAt: null,
    ...extra,
  }
}

export function taskRow(id: ID, extra: Partial<Task> = {}): Task {
  return {
    id,
    createdAt: T0,
    updatedAt: T0,
    title: id,
    notes: [],
    status: 'todo',
    priority: 0,
    dueDate: null,
    dueTime: null,
    estimatePomodoros: null,
    estimateMinutes: null,
    tags: [],
    goalId: GOAL_ID,
    milestoneId: null,
    unitId: null,
    source: 'schedule',
    scheduleKey: null,
    schedulePinned: false,
    skippedOn: null,
    orderInDay: 0,
    subtasks: [],
    recurrence: null,
    seriesId: null,
    order: 0,
    boardOrder: 0,
    startedAt: null,
    completedAt: null,
    completedDay: null,
    ...extra,
  }
}

/** A scheduled task for `chunk`, as `rebalanceGoal` would insert it. */
export function taskFromChunk(chunk: PlannedChunk, id: ID = `task:${chunk.key}`): Task {
  return taskRow(id, { ...chunkFields(chunk) })
}

/** The goal's tasks after applying `diff` (what the repo writes), without Dexie. */
export function applyDiff(tasks: readonly Task[], diff: ScheduleDiff): Task[] {
  const gone = new Set([...diff.remove, ...diff.trash])
  const changes = new Map(diff.update.map((u) => [u.id, u.changes]))
  const out = tasks
    .filter((t) => !gone.has(t.id))
    .map((t) => {
      const c = changes.get(t.id)
      return c ? { ...t, ...c } : t
    })
  for (const chunk of diff.insert) out.push(taskFromChunk(chunk))
  return out
}

/** The goal's tasks marked done on `day` (by id). */
export function completeTasks(tasks: readonly Task[], ids: readonly ID[], day: ISODate): Task[] {
  const set = new Set(ids)
  return tasks.map((t) =>
    set.has(t.id) ? { ...t, status: 'done' as const, completedDay: day, completedAt: T0 } : t,
  )
}
