/**
 * The Calendar layout (pure): which days it shows, where a task sits on the time grid, how tasks that
 * overlap share a day, what a drop at a given height means, and how the keyboard nudges a task.
 *
 * The grid runs 07:00 to 23:00 and grows to fit any task outside those hours. A task with a time is a
 * block as tall as its slot length (`durationMinutes`, else its estimate: minutes, else pomodoros × 25,
 * else 30) but never shorter than 15 minutes; a task with a date and no time sits in the all-day strip.
 */
import { format } from 'date-fns'
import type { HHmm, ISODate, Task } from '@/db/types'
import { addDays, fromISODate, parseHHmm, startOfWeekISO, toHHmm, type WeekStart } from './dates'
import { planDay, planTime } from './taskDates'

export const DEFAULT_START_HOUR = 7
export const DEFAULT_END_HOUR = 23
/** Drops and keyboard nudges land on quarter hours. */
export const SNAP_MINUTES = 15
export const MIN_BLOCK_MINUTES = 15
/** A timed block with no length or estimate. */
export const DEFAULT_BLOCK_MINUTES = 30
const POMODORO_MINUTES = 25
/** Where an untimed task goes the first time it is nudged later. */
export const DEFAULT_TIME: HHmm = '09:00'

// ─── Days ───────────────────────────────────────────────────────────────────

/**
 * The days on screen: a whole week (from the week start that contains `anchor`) for 7, otherwise
 * `count` days starting at `anchor` (the phone's three-day view).
 */
export function visibleDays(anchor: ISODate, count: number, weekStartsOn: WeekStart): ISODate[] {
  const first = count >= 7 ? startOfWeekISO(anchor, weekStartsOn) : anchor
  return Array.from({ length: count >= 7 ? 7 : Math.max(1, count) }, (_, i) => addDays(first, i))
}

/** The anchor after moving one window earlier (-1) or later (1). */
export function shiftAnchor(anchor: ISODate, count: number, direction: -1 | 1): ISODate {
  return addDays(anchor, direction * (count >= 7 ? 7 : Math.max(1, count)))
}

/** "Sep 28 – Oct 4, 2026", "Sep 21 – 27, 2026", "Tue, Sep 29" (one day). */
export function windowLabel(days: readonly ISODate[]): string {
  const first = days[0]
  const last = days[days.length - 1]
  if (first === undefined || last === undefined) return ''
  const a = fromISODate(first)
  const b = fromISODate(last)
  if (first === last) return format(a, 'EEE, MMM d, yyyy')
  if (a.getFullYear() !== b.getFullYear())
    return `${format(a, 'MMM d, yyyy')} – ${format(b, 'MMM d, yyyy')}`
  if (a.getMonth() === b.getMonth())
    return `${format(a, 'MMM d')} – ${format(b, 'd')}, ${format(a, 'yyyy')}`
  return `${format(a, 'MMM d')} – ${format(b, 'MMM d')}, ${format(a, 'yyyy')}`
}

// ─── Blocks ─────────────────────────────────────────────────────────────────

/**
 * How long a task's block is, in minutes (at least `MIN_BLOCK_MINUTES`): its planned slot length,
 * else its estimate.
 */
export function durationOf(
  task: Pick<Task, 'estimateMinutes' | 'estimatePomodoros'> &
    Partial<Pick<Task, 'durationMinutes'>>,
): number {
  const minutes =
    task.durationMinutes != null && task.durationMinutes > 0
      ? task.durationMinutes
      : task.estimateMinutes !== null && task.estimateMinutes > 0
        ? task.estimateMinutes
        : task.estimatePomodoros !== null && task.estimatePomodoros > 0
          ? task.estimatePomodoros * POMODORO_MINUTES
          : DEFAULT_BLOCK_MINUTES
  return Math.max(MIN_BLOCK_MINUTES, minutes)
}

/** Minutes after midnight of a task's planned time, or `null` when it has none (or a malformed one). */
export function startMinutesOf(task: Pick<Task, 'doDate' | 'doTime'>): number | null {
  const time = planTime(task)
  return time === null ? null : parseHHmm(time)
}

export interface TimeRange {
  /** Minutes after midnight, a whole hour. */
  start: number
  end: number
}

/** 07:00–23:00, widened to whole hours around any task that starts earlier or ends later. */
export function timeRangeFor(tasks: readonly Task[]): TimeRange {
  let start = DEFAULT_START_HOUR * 60
  let end = DEFAULT_END_HOUR * 60
  for (const task of tasks) {
    const at = startMinutesOf(task)
    if (at === null) continue
    start = Math.min(start, Math.floor(at / 60) * 60)
    end = Math.max(end, Math.min(24 * 60, Math.ceil((at + durationOf(task)) / 60) * 60))
  }
  return { start, end }
}

export interface PlacedTask {
  task: Task
  /** Minutes after midnight. */
  start: number
  end: number
  /** Which side-by-side slot the block takes when tasks overlap, and how many slots there are. */
  lane: number
  lanes: number
}

/**
 * Lays one day's timed tasks out: tasks that overlap (transitively) share the width in equal lanes, so
 * nothing is hidden behind anything else. Tasks without a time are not placed.
 */
export function placeTimed(tasks: readonly Task[]): PlacedTask[] {
  const items = tasks
    .flatMap((task) => {
      const start = startMinutesOf(task)
      return start === null ? [] : [{ task, start, end: start + durationOf(task) }]
    })
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.end - a.end ||
        (a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0),
    )

  const placed: PlacedTask[] = []
  let cluster: PlacedTask[] = []
  let laneEnds: number[] = []
  let clusterEnd = -1

  const flush = () => {
    for (const p of cluster) p.lanes = laneEnds.length
    placed.push(...cluster)
    cluster = []
    laneEnds = []
  }

  for (const item of items) {
    if (cluster.length > 0 && item.start >= clusterEnd) flush()
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= item.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(item.end)
    } else {
      laneEnds[lane] = item.end
    }
    cluster.push({ ...item, lane, lanes: 1 })
    clusterEnd = cluster.length === 1 ? item.end : Math.max(clusterEnd, item.end)
  }
  flush()
  return placed
}

export interface DayTasks {
  day: ISODate
  allDay: Task[]
  timed: PlacedTask[]
}

/**
 * Splits tasks over the visible days by the day they are planned for (`planDay`). All-day tasks keep
 * the order given; tasks off screen are dropped.
 */
export function tasksByDay(tasks: readonly Task[], days: readonly ISODate[]): DayTasks[] {
  const byDay = new Map<ISODate, Task[]>(days.map((d) => [d, []]))
  for (const task of tasks) {
    const day = planDay(task)
    if (day !== null) byDay.get(day)?.push(task)
  }
  return days.map((day) => {
    const list = byDay.get(day) ?? []
    return {
      day,
      allDay: list.filter((t) => startMinutesOf(t) === null),
      timed: placeTimed(list),
    }
  })
}

/** Every task on screen in reading order (days left to right; all-day first, then by time), for `j`/`k`. */
export function calendarOrderIds(tasks: readonly Task[], days: readonly ISODate[]): string[] {
  return tasksByDay(tasks, days).flatMap((d) => [
    ...d.allDay.map((t) => t.id),
    ...d.timed.map((p) => p.task.id),
  ])
}

/** Tasks that fall on none of the visible days but have a date (for a "nothing this week" hint). */
export function countOnDays(tasks: readonly Task[], days: readonly ISODate[]): number {
  const set = new Set(days)
  return tasks.filter((t) => {
    const day = planDay(t)
    return day !== null && set.has(day)
  }).length
}

// ─── Time on the grid ───────────────────────────────────────────────────────

export function snapMinutes(minutes: number, step: number = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step
}

/**
 * The start time for a block whose top edge is `offsetPx` below the top of the grid, at
 * `pxPerMinute`. Snapped to quarter hours and kept inside the grid (the last slot at the latest).
 */
export function dropTime(offsetPx: number, pxPerMinute: number, range: TimeRange): HHmm {
  const raw = range.start + (pxPerMinute > 0 ? offsetPx / pxPerMinute : 0)
  const latest = Math.max(range.start, range.end - SNAP_MINUTES)
  return toHHmm(Math.min(latest, Math.max(range.start, snapMinutes(raw))))
}

/** Minutes below the top of the grid for "now", or `null` outside the grid. */
export function nowOffset(nowMinutes: number, range: TimeRange): number | null {
  return nowMinutes >= range.start && nowMinutes <= range.end ? nowMinutes - range.start : null
}

/** Minutes after midnight of an instant, in local time. */
export function minutesOfDay(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

/** Hour labels for the gutter: `07:00` … `22:00` as minutes after midnight. */
export function hourMarks(range: TimeRange): number[] {
  const out: number[] = []
  for (let m = range.start; m < range.end; m += 60) out.push(m)
  return out
}

// ─── Keyboard nudges ────────────────────────────────────────────────────────

export interface Slot {
  doDate: ISODate
  doTime: HHmm | null
}

/**
 * Where a task goes when nudged: `days` whole days, and/or a quarter hour earlier (`minutes < 0`) or
 * later. A task with a time moves to the next quarter hour in that direction (14:10 later is 14:15). A
 * task without one is first given `DEFAULT_TIME` when nudged later, and stays put when nudged earlier.
 * A task with only a deadline is moved from the day it is planned for (its deadline stays). Returns
 * `null` when nothing changes (no date, or already at the edge of the day).
 */
export function nudgeSlot(
  task: Pick<Task, 'doDate' | 'doTime' | 'dueDate'>,
  change: { days?: number; minutes?: number },
): Slot | null {
  const day = planDay(task)
  if (day === null) return null
  const doDate = addDays(day, change.days ?? 0)
  const time = planTime(task)
  let doTime: HHmm | null = time
  const minutes = change.minutes ?? 0
  if (minutes !== 0) {
    const at = startMinutesOf(task)
    if (at === null) {
      if (minutes < 0) return null
      doTime = DEFAULT_TIME
    } else {
      const step = Math.abs(minutes)
      const next =
        minutes > 0 ? Math.floor(at / step) * step + step : Math.ceil(at / step) * step - step
      const clamped = Math.min(24 * 60 - SNAP_MINUTES, Math.max(0, next))
      doTime = toHHmm(clamped)
    }
  }
  if (doDate === task.doDate && doTime === time) return null
  return { doDate, doTime }
}
