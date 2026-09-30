/**
 * The weekly review (BRIEF §5.7, PLAN Phase 7C), pure: from what a week held, build the page's numbers
 * and its "wins", and say which day the app offers the review. Nothing reads the clock, Dexie or the DOM.
 *
 * The rules of the words: a win is always something that happened, said plainly and specifically ("12
 * tasks done", "Longest session: 50 min"). A quiet week still gets one kind line, and nothing here ever
 * compares a week unfavourably with another: `comparedToLastWeek` is two neutral numbers, and only a
 * gain becomes a win. A streak freeze is a neutral count, not a warning.
 *
 * Every calendar step goes through the local-date helpers in `./dates` (never `new Date('YYYY-MM-DD')`,
 * which parses as UTC and lands on the wrong day west of Greenwich), and the "unlocked this week" window
 * is `dayStartMs(first day)` to `dayEndMs(last day)`, so a 23- or 25-hour DST day cannot move an
 * instant into the wrong week.
 */
import { format } from 'date-fns'
import type { ISODate, Millis } from '@/db/types'
import { badgeMeta } from './badges'
import {
  addDays,
  dayEndMs,
  dayStartMs,
  eachDay,
  fromISODate,
  isISODate,
  startOfWeekISO,
  weekdayOf,
  type WeekStart,
} from './dates'
import {
  countedMinutes,
  minutesByGoal,
  taskDoneDay,
  type MinutesRow,
  type NamedRef,
  type StatSession,
  type StatTask,
} from './stats'
import { durationText } from './statsLabels'
import type { StreakDayEntry } from './streaks'

/** XP for finishing a weekly review, once per week (the shared ritual amount lives in `./xp`). */
export { XP_RITUAL as XP_WEEKLY_REVIEW } from './xp'

/** The idempotency key of a week's review XP. */
export const reviewXpKey = (weekStart: ISODate): string => `review:${weekStart}`

const MAX_WINS = 6

// ─── Which week, and which day ──────────────────────────────────────────────

/**
 * The day the app offers the review: the last day of the week, Sunday when weeks start on Monday and
 * Saturday when they start on Sunday. Computed on the local calendar day, so it is right in New York
 * (`new Date('2026-09-27')` is a Saturday there).
 */
export function isReviewDay(today: ISODate, weekStartsOn: WeekStart): boolean {
  return weekdayOf(today) === (weekStartsOn === 1 ? 0 : 6)
}

/** First day of the week that holds `day`. */
export const reviewWeekStart = (day: ISODate, weekStartsOn: WeekStart): ISODate =>
  startOfWeekISO(day, weekStartsOn)

/** The last day of the week that starts on `weekStart`. */
export const reviewWeekEnd = (weekStart: ISODate): ISODate => addDays(weekStart, 6)

/**
 * The week the address asks for (`/review/:weekStart?`): any real day is taken to its week's first day,
 * anything else (missing, malformed, `2026-02-30`) is this week, and a week that has not started yet is
 * this week too, since there is nothing to review in it.
 */
export function resolveReviewWeek(
  param: string | undefined,
  today: ISODate,
  weekStartsOn: WeekStart,
): ISODate {
  const current = startOfWeekISO(today, weekStartsOn)
  if (param === undefined || !isISODate(param)) return current
  const asked = startOfWeekISO(param, weekStartsOn)
  return asked > current ? current : asked
}

/** The week before `weekStart`. */
export const previousReviewWeek = (weekStart: ISODate): ISODate => addDays(weekStart, -7)

/** The week after `weekStart`, or `null` when that is a week that has not started yet. */
export function nextReviewWeek(
  weekStart: ISODate,
  today: ISODate,
  weekStartsOn: WeekStart,
): ISODate | null {
  const next = addDays(weekStart, 7)
  return next > startOfWeekISO(today, weekStartsOn) ? null : next
}

// ─── Input and output ───────────────────────────────────────────────────────

export interface ReviewBadge {
  id: string
  unlockedAt: Millis
}

export interface ReviewCourse {
  code: string | null
  title: string
  completedAt: Millis
}

/** One open task that is planned for a day: what the next week's preview adds up. */
export interface ReviewPlannedItem {
  day: ISODate
  /** Its planned length (0 when it has no slot length or estimate; it still counts as an item). */
  minutes: number
}

export interface WeeklyReviewInput {
  /** First day of the week under review. */
  weekStart: ISODate
  weekStartsOn: WeekStart
  today: ISODate
  /** Counted focus sessions; any range that covers the week and the one before it. */
  sessions: readonly StatSession[]
  /** Finished tasks; any range that covers the week and the one before it. */
  tasks: readonly StatTask[]
  goals: readonly NamedRef[]
  /** The streak as it stood at the end of the week (or today, for the week that is not over yet). */
  streak: { current: number; best: number }
  /** How each day of the week stood in the streak engine (`qualified`, `frozen`, …). */
  streakDays: readonly StreakDayEntry[]
  badges: readonly ReviewBadge[]
  courses: readonly ReviewCourse[]
  /** Open tasks planned for the week after `weekStart`'s week (others are ignored). */
  planned: readonly ReviewPlannedItem[]
}

export interface NextWeekDay {
  day: ISODate
  minutes: number
  items: number
}

export interface WeeklyReview {
  range: { from: ISODate; to: ISODate }
  /** The week holds `today`. */
  isCurrentWeek: boolean
  /** The week has ended (`today` is after its last day). */
  isOver: boolean
  /** 1–6 short, specific, positive lines; never empty. */
  wins: string[]
  /** Counted focus minutes, rounded. */
  focusMinutes: number
  /** Counted focus sessions. */
  sessions: number
  tasksDone: number
  /** Days that qualified for the streak. */
  qualifiedDays: number
  /** Days a streak freeze covered. */
  freezesUsed: number
  /** The day with the most focus, when there is one. */
  bestDay: { day: ISODate; minutes: number } | null
  /** Minutes per goal, most first, "Other" last. */
  hoursPerGoal: MinutesRow[]
  streak: { current: number; best: number }
  /** Seven days starting the day after the week ends. */
  nextWeek: NextWeekDay[]
  /** Neutral differences with the week before; the page decides what, if anything, to say. */
  comparedToLastWeek: { focusMinutesDelta: number; tasksDelta: number }
}

// ─── Builder ────────────────────────────────────────────────────────────────

const clean = (n: number): number => Math.round(n * 1000) / 1000
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
const weekdayName = (day: ISODate): string => format(fromISODate(day), 'EEEE')

interface WeekFigures {
  minutes: number
  sessions: number
  longest: number
  byDay: Map<ISODate, number>
  tasks: number
}

function figuresFor(
  from: ISODate,
  to: ISODate,
  sessions: readonly StatSession[],
  tasks: readonly StatTask[],
): WeekFigures {
  const byDay = new Map<ISODate, number>()
  let minutes = 0
  let count = 0
  let longest = 0
  for (const s of sessions) {
    const m = countedMinutes(s)
    if (m === 0 || s.day < from || s.day > to) continue
    minutes += m
    count += 1
    longest = Math.max(longest, m)
    byDay.set(s.day, (byDay.get(s.day) ?? 0) + m)
  }
  let done = 0
  for (const t of tasks) {
    if (t.status !== 'done') continue
    const day = taskDoneDay(t)
    if (day !== null && day >= from && day <= to) done += 1
  }
  return { minutes: clean(minutes), sessions: count, longest: Math.round(longest), byDay, tasks: done }
}

function bestDayOf(byDay: ReadonlyMap<ISODate, number>): { day: ISODate; minutes: number } | null {
  let best: { day: ISODate; minutes: number } | null = null
  for (const [day, minutes] of byDay) {
    // The earlier day wins a tie, so the answer never depends on Map order.
    if (best === null || minutes > best.minutes || (minutes === best.minutes && day < best.day)) {
      best = { day, minutes }
    }
  }
  return best === null ? null : { day: best.day, minutes: Math.round(best.minutes) }
}

function winsFor(args: {
  now: WeekFigures
  before: WeekFigures
  qualifiedDays: number
  streakCurrent: number
  bestDay: { day: ISODate; minutes: number } | null
  badges: readonly ReviewBadge[]
  courses: readonly ReviewCourse[]
  weekStartsOn: WeekStart
}): string[] {
  const { now, before } = args
  const wins: string[] = []

  // Big moments first, so a crowded week keeps them when the list is cut to six.
  if (args.courses.length === 1 && args.courses[0]) {
    const c = args.courses[0]
    wins.push(`Finished ${c.code ? `${c.code} ${c.title}` : c.title}`)
  } else if (args.courses.length > 1) {
    const names = args.courses.map((c) => c.code ?? c.title).join(', ')
    wins.push(`Finished ${args.courses.length} courses: ${names}`)
  }

  const metas = args.badges.flatMap((b) => {
    const meta = badgeMeta(b.id)
    return meta ? [meta] : []
  })
  if (metas.length === 1 && metas[0]) wins.push(`Unlocked ${metas[0].title} ${metas[0].icon}`)
  else if (metas.length > 1) {
    wins.push(`Unlocked ${metas.length} badges: ${metas.map((m) => m.title).join(', ')}`)
  }

  if (now.tasks > 0) wins.push(`You finished ${plural(now.tasks, 'task')}`)
  if (now.minutes > 0) wins.push(`${durationText(now.minutes)} of focus`)
  if (args.streakCurrent >= 3) wins.push(`On a ${args.streakCurrent}-day streak`)
  if (args.qualifiedDays > 0) wins.push(`You showed up on ${plural(args.qualifiedDays, 'day')}`)
  if (now.longest > 0) wins.push(`A ${durationText(now.longest)} session, your longest this week`)
  // A best day is only worth a line when it stands out: two days of the same length have no best.
  const bestIsClear =
    args.bestDay !== null &&
    now.byDay.size > 1 &&
    [...now.byDay.values()].filter((m) => Math.round(m) === args.bestDay?.minutes).length === 1
  if (args.bestDay && bestIsClear) {
    wins.push(
      `${weekdayName(args.bestDay.day)} was your best day, with ${durationText(args.bestDay.minutes)}`,
    )
  }
  // Only a gain is a win. Less is not a fact worth a line.
  const gain = Math.round(now.minutes - before.minutes)
  if (before.minutes > 0 && gain > 0) wins.push(`${durationText(gain)} more focus than last week`)

  if (wins.length === 0) {
    wins.push(`A fresh week starts ${args.weekStartsOn === 1 ? 'Monday' : 'Sunday'}.`)
  }
  return wins.slice(0, MAX_WINS)
}

/** The whole review of one week. See the file comment for the rules of the wording. */
export function buildWeeklyReview(input: WeeklyReviewInput): WeeklyReview {
  const from = input.weekStart
  const to = reviewWeekEnd(from)
  const lastFrom = addDays(from, -7)
  const lastTo = addDays(from, -1)

  const now = figuresFor(from, to, input.sessions, input.tasks)
  const before = figuresFor(lastFrom, lastTo, input.sessions, input.tasks)

  let qualifiedDays = 0
  let freezesUsed = 0
  for (const d of input.streakDays) {
    if (d.day < from || d.day > to) continue
    if (d.status === 'qualified') qualifiedDays += 1
    else if (d.status === 'frozen') freezesUsed += 1
  }

  const startMs = dayStartMs(from)
  const endMs = dayEndMs(to)
  const badges = input.badges.filter((b) => b.unlockedAt >= startMs && b.unlockedAt < endMs)
  const courses = input.courses.filter((c) => c.completedAt >= startMs && c.completedAt < endMs)

  const bestDay = bestDayOf(now.byDay)
  const weekSessions = input.sessions.filter((s) => s.day >= from && s.day <= to)

  const nextFrom = addDays(from, 7)
  const nextWeek: NextWeekDay[] = eachDay(nextFrom, addDays(nextFrom, 6)).map((day) => ({
    day,
    minutes: 0,
    items: 0,
  }))
  const byDay = new Map(nextWeek.map((d) => [d.day, d]))
  for (const item of input.planned) {
    const slot = byDay.get(item.day)
    if (!slot) continue
    slot.items += 1
    slot.minutes += Math.max(0, Math.round(item.minutes))
  }

  return {
    range: { from, to },
    isCurrentWeek: input.today >= from && input.today <= to,
    isOver: input.today > to,
    wins: winsFor({
      now,
      before,
      qualifiedDays,
      streakCurrent: input.streak.current,
      bestDay,
      badges,
      courses,
      weekStartsOn: input.weekStartsOn,
    }),
    focusMinutes: Math.round(now.minutes),
    sessions: now.sessions,
    tasksDone: now.tasks,
    qualifiedDays,
    freezesUsed,
    bestDay,
    hoursPerGoal: minutesByGoal(weekSessions, input.goals, { from, to }),
    streak: { current: input.streak.current, best: input.streak.best },
    nextWeek,
    comparedToLastWeek: {
      focusMinutesDelta: Math.round(now.minutes - before.minutes),
      tasksDelta: now.tasks - before.tasks,
    },
  }
}
