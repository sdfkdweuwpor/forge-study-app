/**
 * Everyday-task auto-slotting (pure): tasks with a due date but no do date get the earliest open slot
 * that ends before they are due. Earliest due first, then shortest first (then id), so a tight deadline
 * is never crowded out by a later one. A task is never split; one that fits nowhere before its due
 * time is reported, not forced. Results are suggestions: the caller applies them after confirmation.
 */
import type { HHmm, ISODate, Millis } from '@/db/types'
import { dayOf, minutesOfDay } from '../dates'
import { ceilTo, dayNumber, isoOfDay } from './capacity'
import type { AvailabilityV2, BusyBlock } from './plannerTypes'
import { busyMapOf, SlotBook } from './slotBook'
import { DAY_MINUTES, formatClock, makeDayIntervals, parseClock } from './windows'

/** Length assumed for a task without an estimate. */
export const DEFAULT_TASK_MINUTES = 25

export interface AutoSlotTask {
  id: string
  estimateMinutes: number | null
  dueDate: ISODate
  /** Due by this time on `dueDate`; `null` = by the end of that day. */
  dueTime?: HHmm | null
}

export type AutoSlotResult =
  | { taskId: string; doDate: ISODate; startTime: HHmm }
  /** `noRoom`: no open slot long enough before it is due; `pastDue`: already due. */
  | { taskId: string; reason: 'noRoom' | 'pastDue' }

export interface AutoSlotOptions {
  grain?: number
}

/**
 * Slots `tasks` into the free time of `availability` (its windows, shift pattern and blackouts) around
 * `busy` (planned study sessions, timed tasks, calendar events), from `now` on. Results are in input order.
 */
export function autoSlotTasks(
  tasks: readonly AutoSlotTask[],
  busy: readonly BusyBlock[],
  availability: AvailabilityV2,
  now: Millis,
  opts: AutoSlotOptions = {},
): AutoSlotResult[] {
  const grain = Math.max(1, Math.round(opts.grain ?? 5))
  const today = dayNumber(dayOf(now))
  const nowMin = Math.min(DAY_MINUTES, ceilTo(minutesOfDay(now), grain))
  const book = new SlotBook({
    dayIntervals: makeDayIntervals(availability),
    busy: busyMapOf(busy),
    startDay: today,
    startMinute: nowMin,
    grain,
  })
  const prepared = tasks.map((t) => {
    const m = t.estimateMinutes !== null && Number.isFinite(t.estimateMinutes) && t.estimateMinutes > 0
    let dueDay: number | null
    try {
      dueDay = dayNumber(t.dueDate)
    } catch {
      dueDay = null
    }
    return {
      t,
      minutes: ceilTo(m ? (t.estimateMinutes as number) : DEFAULT_TASK_MINUTES, grain),
      dueDay,
      dueMin: (t.dueTime ? parseClock(t.dueTime) : null) ?? DAY_MINUTES,
    }
  })
  const order = [...prepared].sort(
    (a, b) =>
      (a.dueDay ?? Number.NEGATIVE_INFINITY) - (b.dueDay ?? Number.NEGATIVE_INFINITY) ||
      a.dueMin - b.dueMin ||
      a.minutes - b.minutes ||
      (a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0),
  )
  const result = new Map<string, AutoSlotResult>()
  for (const x of order) {
    const { t, minutes, dueDay, dueMin } = x
    if (dueDay === null || dueDay < today || (dueDay === today && dueMin <= nowMin)) {
      result.set(t.id, { taskId: t.id, reason: 'pastDue' })
      continue
    }
    let placed: AutoSlotResult | null = null
    for (let d = today; d <= dueDay && !placed; d++) {
      const at = book.firstFit(d, 0, minutes)
      if (at === null) continue
      if (d === dueDay && at + minutes > dueMin) break
      book.reserve(d, at, at + minutes)
      placed = { taskId: t.id, doDate: isoOfDay(d), startTime: formatClock(at) }
    }
    result.set(t.id, placed ?? { taskId: t.id, reason: 'noRoom' })
  }
  return tasks.map((t) => result.get(t.id) as AutoSlotResult)
}
