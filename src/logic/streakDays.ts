/**
 * What a `streakDays` row says about one day (pure). `streakDays` is a rebuildable cache: every field
 * is derived from counted focus sessions, finished tasks, XP events and the daily goal, so the repo
 * can recompute any day at any time and get the same row.
 *
 * - `focusMinutes` / `focusSessions`: counted, completed focus sessions of the day.
 * - `pomodoros`: the same count the daily-goal ring shows (`pomodorosDone`).
 * - `tasksDone`: tasks finished that day.
 * - `dailyGoalTarget`: the goal in pomodoros. It is a snapshot: a day before today keeps the target its
 *   row already had, so changing the goal later never rewrites history. Today follows the setting.
 * - `qualified`: a counted session or the daily goal (`isDayQualified`).
 * - `xp`: what the XP log attributes to the day, reversals included.
 *
 * A day with no activity has no row (`null` from `summarizeDay`), which keeps the table small.
 */
import type { ISODate, Session, StreakDay, Task, XpEvent } from '@/db/types'
import { isDayQualified } from './streaks'
import { pomodorosDone } from './todayStats'

/** What is stored for a day, without the row bookkeeping (`id` = `day`, timestamps). */
export type StreakDayValues = Omit<StreakDay, 'id' | 'createdAt' | 'updatedAt'>

type SessionRow = Pick<Session, 'kind' | 'mode' | 'status' | 'counted' | 'actualMinutes' | 'day'>
type TaskRow = Pick<Task, 'status' | 'completedDay'>
type XpRow = Pick<XpEvent, 'day' | 'amount'>

export interface DaySources {
  sessions: readonly SessionRow[]
  tasks: readonly TaskRow[]
  xpEvents: readonly XpRow[]
}

export interface DaySettings {
  /** The day the app is on: it decides whose goal snapshot follows the setting. */
  today: ISODate
  /** Minutes in a pomodoro (custom and stopwatch sessions are worth whole pomodoros of it). */
  pomodoroMin: number
  dailyGoalPomodoros: number
  /** Rows already stored, by day: past days keep their `dailyGoalTarget`. */
  existing: ReadonlyMap<ISODate, Pick<StreakDay, 'dailyGoalTarget'>>
}

interface Bucket {
  sessions: SessionRow[]
  tasksDone: number
  xp: number
}

/** The stored fields of one day, or `null` when nothing happened on it. */
export function summarizeDay(
  day: ISODate,
  bucket: { sessions: readonly SessionRow[]; tasksDone: number; xp: number },
  settings: DaySettings,
): StreakDayValues | null {
  let focusMinutes = 0
  let focusSessions = 0
  for (const s of bucket.sessions) {
    if (s.kind !== 'focus' || s.status !== 'completed' || !s.counted) continue
    focusSessions += 1
    focusMinutes += Math.max(0, Math.floor(s.actualMinutes ?? 0))
  }
  const pomodoros = pomodorosDone(bucket.sessions, day, settings.pomodoroMin)

  const kept = day < settings.today ? settings.existing.get(day)?.dailyGoalTarget : undefined
  const dailyGoalTarget = Math.max(1, Math.round(kept ?? settings.dailyGoalPomodoros))
  const dailyGoalHit = pomodoros >= dailyGoalTarget

  const values: StreakDayValues = {
    day,
    focusMinutes,
    focusSessions,
    pomodoros,
    tasksDone: bucket.tasksDone,
    dailyGoalTarget,
    dailyGoalHit,
    qualified: isDayQualified({ focusSessions, dailyGoalHit }),
    xp: bucket.xp,
  }
  const quiet =
    focusSessions === 0 && focusMinutes === 0 && bucket.tasksDone === 0 && bucket.xp === 0
  return quiet && !dailyGoalHit ? null : values
}

/**
 * The rows for every day in `[from, to]` that had activity, keyed by day. One pass over the sources:
 * cost grows with the number of rows, not with the number of days in the range.
 */
export function buildStreakDays(
  from: ISODate,
  to: ISODate,
  sources: DaySources,
  settings: DaySettings,
): Map<ISODate, StreakDayValues> {
  const buckets = new Map<ISODate, Bucket>()
  const bucketOf = (day: ISODate): Bucket | null => {
    if (day < from || day > to) return null
    let b = buckets.get(day)
    if (!b) {
      b = { sessions: [], tasksDone: 0, xp: 0 }
      buckets.set(day, b)
    }
    return b
  }

  for (const s of sources.sessions) {
    if (s.kind === 'focus') bucketOf(s.day)?.sessions.push(s)
  }
  for (const t of sources.tasks) {
    if (t.status === 'done' && t.completedDay) {
      const b = bucketOf(t.completedDay)
      if (b) b.tasksDone += 1
    }
  }
  for (const e of sources.xpEvents) {
    const b = bucketOf(e.day)
    if (b) b.xp += e.amount
  }

  const rows = new Map<ISODate, StreakDayValues>()
  for (const [day, bucket] of buckets) {
    const values = summarizeDay(day, bucket, settings)
    if (values) rows.set(day, values)
  }
  return rows
}

/** Whether two rows say the same thing (timestamps and id aside). */
export function sameDayValues(a: StreakDayValues, b: StreakDayValues): boolean {
  return (
    a.day === b.day &&
    a.focusMinutes === b.focusMinutes &&
    a.focusSessions === b.focusSessions &&
    a.pomodoros === b.pomodoros &&
    a.tasksDone === b.tasksDone &&
    a.dailyGoalTarget === b.dailyGoalTarget &&
    a.dailyGoalHit === b.dailyGoalHit &&
    a.qualified === b.qualified &&
    a.xp === b.xp
  )
}

/** Whether a stored row has every field of the current shape (an older build's rows are rebuilt). */
export function hasCurrentShape(row: Partial<StreakDay>): boolean {
  return (
    typeof row.day === 'string' &&
    row.id === row.day &&
    typeof row.focusMinutes === 'number' &&
    typeof row.focusSessions === 'number' &&
    typeof row.pomodoros === 'number' &&
    typeof row.tasksDone === 'number' &&
    typeof row.dailyGoalTarget === 'number' &&
    typeof row.dailyGoalHit === 'boolean' &&
    typeof row.qualified === 'boolean' &&
    typeof row.xp === 'number'
  )
}
