/**
 * The Today screen's data (pure): which tasks belong on it, how they group, and the single task to
 * do next. `today` and `now` are injected; nothing here reads the clock.
 *
 * What is on Today (by the day a task is planned for, `planDay`: its do date, else its deadline): open
 * tasks planned for today, open tasks carried over from an earlier day, and tasks already in progress
 * (`doing`) even when their date is later or empty. Tasks skipped for today (`skippedOn === today`)
 * are hidden. Finished tasks appear only as "completed today".
 *
 * No guilt: work from an earlier day is "carried over" and says which day it is from ("from Tue"),
 * never how many days late it is.
 */
import type { ISODate, Millis, Task } from '@/db/types'
import { dayEndMs, dayStartMs, diffDays, parseHHmm } from './dates'
import { planDay, planTime } from './taskDates'

export interface TodayContext {
  /** The local calendar day being shown. */
  today: ISODate
  /**
   * The current instant. Accepted so callers can pass one context object everywhere; grouping and
   * picking are by calendar day and start time, so they do not depend on the clock.
   */
  now?: Millis
}

export interface CarriedOverTask {
  task: Task
  /** The earlier day it was planned for. */
  from: ISODate
  /** Whole calendar days since then (≥ 1); for ordering, not for display. */
  daysAgo: number
}

export interface TodayGroups {
  /** Scheduler and flashcard work generated from goals. */
  fromGoals: Task[]
  /** Everything else planned for today (or in progress). */
  yours: Task[]
  /** Open tasks planned for an earlier day: highest priority first, then the oldest. */
  carriedOver: CarriedOverTask[]
  /** Finished today, latest first. */
  completedToday: Task[]
}

/** Work that came from a goal's plan rather than being added by hand. */
export function isGoalWork(task: Task): boolean {
  return task.source === 'schedule' || task.source === 'flashcards'
}

function byId(a: Task, b: Task): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function isOpenToday(task: Task, today: ISODate): boolean {
  return task.status !== 'done' && task.skippedOn !== today
}

/** Minutes after midnight of a task's planned start on `today`; `Infinity` when it has none. */
function startMinutes(task: Task, today: ISODate): number {
  const time = planTime(task)
  if (task.doDate !== today || time === null) return Infinity
  return parseHHmm(time) ?? Infinity
}

/** Timed tasks first (by time), then the day's own order, then priority, then list order. */
function compareDayOrder(today: ISODate): (a: Task, b: Task) => number {
  return (a, b) => {
    const ta = startMinutes(a, today)
    const tb = startMinutes(b, today)
    if (ta !== tb) return ta < tb ? -1 : 1
    return (
      a.orderInDay - b.orderInDay ||
      b.priority - a.priority ||
      a.order - b.order ||
      a.createdAt - b.createdAt ||
      byId(a, b)
    )
  }
}

/** Highest priority first, then timed tasks, then the day's own order and list order. */
function comparePriorityFirst(today: ISODate): (a: Task, b: Task) => number {
  const dayOrder = compareDayOrder(today)
  return (a, b) => b.priority - a.priority || dayOrder(a, b)
}

function completedOn(task: Task, today: ISODate): boolean {
  if (task.status !== 'done') return false
  if (task.completedDay !== null) return task.completedDay === today
  return (
    task.completedAt !== null &&
    task.completedAt >= dayStartMs(today) &&
    task.completedAt < dayEndMs(today)
  )
}

function carriedOverEntries(tasks: readonly Task[], today: ISODate): CarriedOverTask[] {
  const out: CarriedOverTask[] = []
  for (const task of tasks) {
    const day = planDay(task)
    if (!isOpenToday(task, today) || day === null || day >= today) continue
    out.push({ task, from: day, daysAgo: diffDays(today, day) })
  }
  return out.sort(
    (a, b) =>
      b.task.priority - a.task.priority ||
      b.daysAgo - a.daysAgo ||
      a.task.order - b.task.order ||
      a.task.createdAt - b.task.createdAt ||
      byId(a.task, b.task),
  )
}

/** Splits tasks into the Today screen's sections. */
export function groupToday(tasks: readonly Task[], ctx: TodayContext): TodayGroups {
  const { today } = ctx
  const fromGoals: Task[] = []
  const yours: Task[] = []
  const completedToday: Task[] = []

  for (const task of tasks) {
    if (task.status === 'done') {
      if (completedOn(task, today)) completedToday.push(task)
      continue
    }
    if (!isOpenToday(task, today)) continue
    const day = planDay(task)
    if (day !== null && day < today) continue
    if (day === today || task.status === 'doing') (isGoalWork(task) ? fromGoals : yours).push(task)
  }

  const order = compareDayOrder(today)
  fromGoals.sort(order)
  yours.sort(order)
  completedToday.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || byId(a, b))
  return { fromGoals, yours, carriedOver: carriedOverEntries(tasks, today), completedToday }
}

/**
 * The one task to do next, or `null` when nothing is actionable. In order:
 *  1. a task already in progress (most recently started first);
 *  2. goal work due today, by start time then the day's order;
 *  3. carried-over tasks, highest priority (then the oldest) first;
 *  4. today's own tasks, highest priority first, then timed, then list order.
 */
export function pickNow(tasks: readonly Task[], ctx: TodayContext): Task | null {
  const { today } = ctx
  const open = tasks.filter((t) => isOpenToday(t, today))

  const inProgress = open
    .filter((t) => t.status === 'doing')
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || a.order - b.order || byId(a, b))
  if (inProgress[0]) return inProgress[0]

  const planned = open.filter((t) => planDay(t) === today)
  const goalWork = planned.filter(isGoalWork).sort(compareDayOrder(today))
  if (goalWork[0]) return goalWork[0]

  const carried = carriedOverEntries(open, today)
  if (carried[0]) return carried[0].task

  const own = planned.filter((t) => !isGoalWork(t)).sort(comparePriorityFirst(today))
  return own[0] ?? null
}
