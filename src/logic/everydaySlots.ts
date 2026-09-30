/**
 * Suggested times for everyday tasks (pure). A task that has a deadline, no do date and the "Auto-schedule
 * before deadline" switch on is offered the earliest open slot in the person's everyday hours that ends
 * before it is due, around everything that already has a time (everyday tasks and goal study sessions).
 * These are only suggestions: the caller applies one after a yes.
 */
import type { DateRange, HHmm, ISODate, Millis, Task, TimeWindow } from '@/db/types'
import { durationOf } from './calendarWeek'
import { defaultTaskWindows } from './schemaV2'
import { autoSlotTasks } from './scheduler/autoSlot'
import type { AvailabilityV2, BusyBlock, WeekWindows } from './scheduler/plannerTypes'
import { formatDayLong, formatTimeOfDay } from './taskDisplay'

/** Length of a suggested slot when the task does not say (the calendar draws such a block the same size). */
export const DEFAULT_SLOT_MINUTES = 30

export const defaultEverydayWindows = defaultTaskWindows

/** What `defaultTaskWindows` gave before the everyday defaults: open all day, every day. */
function isLegacyOpenDay(windows: readonly (readonly TimeWindow[])[]): boolean {
  return (
    windows.length === 7 &&
    windows.every((day) => day.length === 1 && day[0]?.start === '09:00' && day[0]?.end === '21:00')
  )
}

/** The stored windows, or the everyday defaults when they are missing, malformed or the old untouched default. */
export function everydayWindowsOf(
  stored: readonly (readonly TimeWindow[])[] | undefined,
): TimeWindow[][] {
  if (!stored || stored.length !== 7 || isLegacyOpenDay(stored)) return defaultEverydayWindows()
  return stored.map((day) => day.map((w) => ({ ...w })))
}

export function everydayAvailability(
  stored: readonly (readonly TimeWindow[])[] | undefined,
  blackouts: readonly DateRange[] = [],
): AvailabilityV2 {
  return {
    weekly: everydayWindowsOf(stored) as unknown as WeekWindows,
    sessionMinutes: 50,
    blackouts,
    shiftPattern: null,
  }
}

const isOpen = (t: Task): boolean => t.status !== 'done'

/** Open tasks with a do date and time: those hours are taken. */
export function busyBlocksOf(tasks: readonly Task[]): BusyBlock[] {
  return tasks.flatMap((t): BusyBlock[] =>
    isOpen(t) && t.doDate !== null && t.doTime !== null
      ? [
          {
            date: t.doDate,
            start: t.doTime,
            durationMinutes: durationOf(t),
            source: 'task',
            id: t.id,
          },
        ]
      : [],
  )
}

/** Tasks that may be suggested a time: opted in, with a deadline and no day of their own. */
export function autoSlotCandidates(tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => isOpen(t) && t.autoSlot && t.dueDate !== null && t.doDate === null)
}

/** How long a task's suggested slot is: its slot length, else its estimate, else 30 minutes. */
export function slotMinutesOf(task: Pick<Task, 'durationMinutes' | 'estimateMinutes' | 'estimatePomodoros'>): number {
  const explicit =
    (task.durationMinutes ?? 0) > 0 ||
    (task.estimateMinutes ?? 0) > 0 ||
    (task.estimatePomodoros ?? 0) > 0
  return explicit ? durationOf(task) : DEFAULT_SLOT_MINUTES
}

export interface SlotSuggestion {
  taskId: string
  title: string
  doDate: ISODate
  startTime: HHmm
  minutes: number
  dueDate: ISODate
}

export interface NoRoom {
  taskId: string
  title: string
  dueDate: ISODate
  /** `noRoom`: nothing open before it is due; `pastDue`: it is already due. */
  reason: 'noRoom' | 'pastDue'
}

export interface AutoSlotProposal {
  suggestions: SlotSuggestion[]
  noRoom: NoRoom[]
}

/** Computes suggestions for every candidate, earliest deadline first, around the busy time. */
export function suggestAutoSlots(
  tasks: readonly Task[],
  stored: readonly (readonly TimeWindow[])[] | undefined,
  blackouts: readonly DateRange[],
  now: Millis,
): AutoSlotProposal {
  const candidates = autoSlotCandidates(tasks)
  if (candidates.length === 0) return { suggestions: [], noRoom: [] }
  const minutesById = new Map(candidates.map((t) => [t.id, slotMinutesOf(t)]))
  const results = autoSlotTasks(
    candidates.map((t) => ({
      id: t.id,
      estimateMinutes: minutesById.get(t.id) ?? DEFAULT_SLOT_MINUTES,
      dueDate: t.dueDate as ISODate,
      dueTime: t.dueTime,
    })),
    busyBlocksOf(tasks),
    everydayAvailability(stored, blackouts),
    now,
  )
  const suggestions: SlotSuggestion[] = []
  const noRoom: NoRoom[] = []
  candidates.forEach((task, i) => {
    const r = results[i]
    if (!r) return
    if ('reason' in r)
      noRoom.push({ taskId: task.id, title: task.title, dueDate: task.dueDate as ISODate, reason: r.reason })
    else
      suggestions.push({
        taskId: task.id,
        title: task.title,
        doDate: r.doDate,
        startTime: r.startTime,
        minutes: minutesById.get(task.id) ?? DEFAULT_SLOT_MINUTES,
        dueDate: task.dueDate as ISODate,
      })
  })
  suggestions.sort(
    (a, b) => (a.doDate < b.doDate ? -1 : a.doDate > b.doDate ? 1 : a.startTime < b.startTime ? -1 : 1),
  )
  return { suggestions, noRoom }
}

/** "Thu 7 PM" (or "Today 7 PM") for a suggestion's time. */
export function suggestionWhen(s: Pick<SlotSuggestion, 'doDate' | 'startTime'>, today: ISODate): string {
  const day = s.doDate === today ? 'Today' : (formatDayLong(s.doDate, today).split(',')[0] ?? s.doDate)
  return `${day} ${formatTimeOfDay(s.startTime)}`
}

/** "Pay phone bill → Thu 7 PM (30 min)". */
export function describeSuggestion(s: SlotSuggestion, today: ISODate): string {
  return `${s.title} → ${suggestionWhen(s, today)} (${s.minutes} min)`
}

/** Gentle words for a task nothing could be found for: "No open time before Fri — pick a time". */
export function describeNoRoom(n: NoRoom, today: ISODate): string {
  if (n.reason === 'pastDue') return 'It’s past its deadline, so pick a time that works'
  const day =
    n.dueDate === today ? 'today' : (formatDayLong(n.dueDate, today).split(',')[0] ?? n.dueDate)
  return `No open time before ${day} — pick a time`
}

