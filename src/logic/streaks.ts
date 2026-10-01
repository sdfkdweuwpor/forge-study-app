/**
 * The streak engine (BRIEF §5.7, PLAN Phase 7A). Pure: `computeStreak` reads what each day was and
 * says how the streak stands. Nothing is stored; the freeze is computed every time from the days, so
 * the answer can never drift from the history.
 *
 * The rules:
 * - A day qualifies with one counted focus session or by hitting the daily goal (`isDayQualified`).
 * - A day that did not qualify is a neutral `rest` day. Nothing here scolds: there is no "lost",
 *   no "broken" and no countdown, only statuses.
 * - One automatic freeze per week (weeks start on `weekStartsOn`). It covers a finished day that did
 *   not qualify while a streak is running: the streak carries on but does not grow (`frozen`). A
 *   second such day in the same week ends the streak.
 * - Today without a qualifying session yet is `today-open`. It never ends anything.
 * - A freeze is only ever spent on a day the streak then survives. If the streak ends anyway (nothing
 *   qualified after the covered day), that day reads as a plain `rest` day and the freeze is not
 *   counted as used, so a freeze is never wasted on a streak that was already over.
 * - The scan starts at the first record, or 400 days before today when that is later. A streak that
 *   was already running at the start of a clipped scan has an unknown true start, so it pays no
 *   milestones (the milestone keys would drift as the window slides).
 *
 * All day arithmetic is on integer day numbers (`dayNumber`), so a DST change cannot add or drop a
 * day and the whole scan is a few hundred integer steps. Input may be unsorted and repeated.
 */
import type { ISODate, StreakDay } from '@/db/types'
import { isISODate, type WeekStart } from './dates'
import { dayNumber, isoOfDay, weekdayOfDay } from './scheduler/capacity'
import { STREAK_MILESTONES, type StreakMilestone } from './xp'

/** How many days before today the scan reaches back at most. */
export const SCAN_DAYS = 400

/** The least a day has to say for the engine: the day and whether it qualified. */
export type StreakRecord = Pick<StreakDay, 'day' | 'qualified'>

/**
 * How one day stands:
 * - `qualified`: a counted focus session or the daily goal; adds 1 to the streak.
 * - `frozen`: the weekly freeze covered a day that did not qualify; the streak carries on, unchanged.
 * - `rest`: a finished day that did not qualify and was not covered. Neutral: it just is a rest day.
 * - `today-open`: today, with nothing qualifying yet. It changes nothing.
 * - `future`: after today (only the rest of the current week is listed, so a week grid can be drawn).
 */
export type StreakDayStatus = 'qualified' | 'frozen' | 'rest' | 'today-open' | 'future'

export interface StreakDayEntry {
  day: ISODate
  status: StreakDayStatus
}

/** A milestone a streak reached: its length, the day it was reached and its idempotency key. */
export interface StreakMilestoneReached {
  days: StreakMilestone
  /** The day the streak's `days`-th qualifying day happened. */
  on: ISODate
  /** `streak:<days>:<first qualifying day of that streak>`: the same for as long as the streak lives. */
  key: string
}

export interface StreakResult {
  /** Qualifying days in the streak that is running now (0 when none is). Frozen days do not add. */
  current: number
  /** The longest streak in the scanned days (never less than `current`). */
  best: number
  /** First qualifying day of the running streak, or `null` when none is running. */
  currentStart: ISODate | null
  /** Every scanned day, oldest first, then the rest of today's week as `future`. */
  days: StreakDayEntry[]
  /** Days a freeze covered in the scanned days. */
  freezesUsed: number
  /** Whether this week (the one containing today) has not spent its freeze yet. */
  freezeAvailableThisWeek: boolean
  /**
   * The 7, 30 and 100-day milestones reached by any streak in the scan, in the order they happened.
   * The running streak's keys are `streak:<days>:<currentStart>`.
   */
  milestonesReached: StreakMilestoneReached[]
}

/** The idempotency key of a milestone: the same for as long as that streak lives. */
export function streakMilestoneKey(days: number, streakStart: ISODate): string {
  return `streak:${days}:${streakStart}`
}

/** A day qualifies with at least one counted focus session, or by hitting the daily goal. */
export function isDayQualified(day: { focusSessions: number; dailyGoalHit: boolean }): boolean {
  return day.focusSessions >= 1 || day.dailyGoalHit
}

/** Day number of the first day of the week that contains day number `n`. */
function weekOf(n: number, weekStartsOn: WeekStart): number {
  const since = (((weekdayOfDay(n) - weekStartsOn) % 7) + 7) % 7
  return n - since
}

const MILESTONE_DAYS: ReadonlySet<number> = new Set<number>(STREAK_MILESTONES)

interface Reached {
  days: StreakMilestone
  on: number
  start: number
}

/**
 * How the streak stands on `today`, given a record for each day that had activity (days without a
 * record did not qualify). `weekStartsOn` decides which days share a freeze.
 */
export function computeStreak(
  records: readonly StreakRecord[],
  today: ISODate,
  weekStartsOn: WeekStart,
): StreakResult {
  const todayN = dayNumber(today)

  const qualified = new Set<number>()
  let first = todayN
  for (const record of records) {
    if (!isISODate(record.day)) continue
    const n = dayNumber(record.day)
    if (n > todayN) continue
    if (n < first) first = n
    if (record.qualified) qualified.add(n)
  }

  const scanStart = Math.max(first, todayN - SCAN_DAYS)
  const clipped = first < scanStart
  const length = todayN - scanStart + 1
  const status: StreakDayStatus[] = new Array<StreakDayStatus>(length)

  /** Weeks (by their first day) whose freeze is spent, provisionally or for good. */
  const spent = new Set<number>()
  /** Frozen days after the last qualifying day: only confirmed once a later day qualifies. */
  let unconfirmed: number[] = []
  let active = false
  let run = 0
  let runStart = 0
  let runClipped = false
  let best = 0
  const reached: Reached[] = []

  for (let i = 0; i < length; i++) {
    const n = scanStart + i
    if (qualified.has(n)) {
      unconfirmed = []
      if (!active) {
        active = true
        run = 0
        runStart = n
        // Already running when the scan began: its real start is out of sight.
        runClipped = clipped && i === 0 && qualified.has(n - 1)
      }
      run += 1
      status[i] = 'qualified'
      if (run > best) best = run
      if (!runClipped && MILESTONE_DAYS.has(run)) {
        reached.push({ days: run as StreakMilestone, on: n, start: runStart })
      }
    } else if (n === todayN) {
      status[i] = 'today-open'
    } else if (!active) {
      status[i] = 'rest'
    } else {
      const week = weekOf(n, weekStartsOn)
      if (!spent.has(week)) {
        spent.add(week)
        status[i] = 'frozen'
        unconfirmed.push(i)
      } else {
        // A second day off in one week: the streak is over. What was frozen after its last
        // qualifying day saved nothing, so those days are plain rest days and their freezes are unspent.
        for (const j of unconfirmed) {
          status[j] = 'rest'
          spent.delete(weekOf(scanStart + j, weekStartsOn))
        }
        unconfirmed = []
        status[i] = 'rest'
        active = false
        run = 0
      }
    }
  }

  const thisWeek = weekOf(todayN, weekStartsOn)
  const days: StreakDayEntry[] = []
  let freezesUsed = 0
  for (let i = 0; i < length; i++) {
    const s = status[i] ?? 'rest'
    if (s === 'frozen') freezesUsed += 1
    days.push({ day: isoOfDay(scanStart + i), status: s })
  }
  for (let n = todayN + 1; n <= thisWeek + 6; n++) days.push({ day: isoOfDay(n), status: 'future' })

  return {
    current: active ? run : 0,
    best,
    currentStart: active ? isoOfDay(runStart) : null,
    days,
    freezesUsed,
    freezeAvailableThisWeek: !spent.has(thisWeek),
    milestonesReached: reached.map((m) => {
      const start = isoOfDay(m.start)
      return { days: m.days, on: isoOfDay(m.on), key: streakMilestoneKey(m.days, start) }
    }),
  }
}

/** The status of `day` in a result, or `undefined` when the scan does not list it. */
export function statusOn(result: StreakResult, day: ISODate): StreakDayStatus | undefined {
  return result.days.find((d) => d.day === day)?.status
}
