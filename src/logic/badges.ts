/**
 * Badges (BRIEF §5.5, PLAN §6 / 6C). Pure: `evaluateBadges` reads history and says which badges are
 * earned and when. It never decides what to store or show (`db/repos/badges.ts` inserts, the grid renders).
 *
 * Rules shared by all of them:
 * - Only counted focus sessions count (`kind: 'focus'`, `status: 'completed'`, `counted`): a session under
 *   the 80% rule, a break, or a thrown-away one earns nothing.
 * - `unlockedAt` is the moment the condition first became true, so evaluating again on more data gives the
 *   same moment. A session's verdict (counted) is only known when it ends, so session badges unlock at its
 *   `endedAt`, even when the condition looks at when it started.
 * - Clock times are read on the local wall clock (`getHours`), so a DST change moves nothing: 07:30 is
 *   early on a 23-hour day and on a 25-hour day alike.
 * - Streak badges read a `BadgeStreak`, the day-by-day streak state. `computeStreakForBadges` builds it
 *   from `streakDays` rows and is the one seam Phase 7's streak engine replaces (it will add freezes).
 */
import { format, getHours, getYear } from 'date-fns'
import type {
  Badge,
  BadgeId,
  Goal,
  ID,
  ISODate,
  Milestone,
  Millis,
  Session,
  StreakDay,
} from '@/db/types'
import { dayStartMs, diffDays, eachDay, fromISODate, isISODate } from './dates'

// ─── Definitions ────────────────────────────────────────────────────────────

/** A session that starts before this local hour is "early" (08:00). */
export const EARLY_BIRD_BEFORE_HOUR = 8
/** Night owl: started from 22:00 up to (not including) 04:00 the next morning. */
export const NIGHT_OWL_FROM_HOUR = 22
export const NIGHT_OWL_BEFORE_HOUR = 4
/** Deep work: this many counted sessions in one local day. */
export const DEEP_WORK_SESSIONS = 4
/** 100 hours of counted focus. */
export const HOURS_100_MINUTES = 6000
/** Streak badges and the run of qualifying days each one asks for. */
export const STREAK_BADGES = [
  { id: 'streak-7', days: 7 },
  { id: 'streak-30', days: 30 },
  { id: 'streak-100', days: 100 },
] as const satisfies readonly { id: BadgeId; days: number }[]
/** Comeback: an earlier streak of at least this many days ended, then this many days in a row again. */
export const COMEBACK_MIN_STREAK = 3
export const COMEBACK_RUN = 3

export interface BadgeMeta {
  id: BadgeId
  title: string
  /** Past tense, shown once earned. */
  description: string
  /** Encouraging and in the imperative, shown while locked. Never shames. */
  hint: string
  /** One emoji. */
  icon: string
}

/** In the brief's order; the grid shows them in this order. */
export const BADGES: readonly BadgeMeta[] = [
  {
    id: 'first-focus',
    title: 'First Focus',
    description: 'Finished your first focus session.',
    hint: 'Finish your first focus session.',
    icon: '🌱',
  },
  {
    id: 'early-bird',
    title: 'Early Bird',
    description: 'Started a focus session before 8 a.m.',
    hint: 'Start a session before 8 a.m.',
    icon: '🌅',
  },
  {
    id: 'night-owl',
    title: 'Night Owl',
    description: 'Focused late, between 10 p.m. and 4 a.m.',
    hint: 'Start a session between 10 p.m. and 4 a.m.',
    icon: '🦉',
  },
  {
    id: 'streak-7',
    title: '7-Day Streak',
    description: 'Focused 7 days in a row.',
    hint: 'Focus 7 days in a row, one day at a time.',
    icon: '🔥',
  },
  {
    id: 'streak-30',
    title: '30-Day Streak',
    description: 'Focused 30 days in a row.',
    hint: 'Focus 30 days in a row, one day at a time.',
    icon: '🔥',
  },
  {
    id: 'streak-100',
    title: '100-Day Streak',
    description: 'Focused 100 days in a row.',
    hint: 'Focus 100 days in a row, one day at a time.',
    icon: '🔥',
  },
  {
    id: 'deep-work',
    title: 'Deep Work',
    description: 'Finished 4 focus sessions in one day.',
    hint: 'Finish 4 focus sessions in one day.',
    icon: '🧠',
  },
  {
    id: 'first-course',
    title: 'First Course Complete',
    description: 'Completed your first course.',
    hint: 'Mark a course as done.',
    icon: '🎓',
  },
  {
    id: 'term-complete',
    title: 'Term Complete',
    description: 'Finished every course in a term.',
    hint: 'Finish every course assigned to a term.',
    icon: '🏆',
  },
  {
    id: 'hours-100',
    title: '100 Hours Focused',
    description: 'Focused for 100 hours in total.',
    hint: 'Focus for 100 hours in total. Every session adds up.',
    icon: '⏳',
  },
  {
    id: 'comeback',
    title: 'Comeback',
    description: 'Got back into a rhythm after a break.',
    hint: 'After a break, focus 3 days in a row again.',
    icon: '🌤️',
  },
]

const META_BY_ID: ReadonlyMap<string, BadgeMeta> = new Map(BADGES.map((b) => [b.id, b]))
const ORDER_BY_ID: ReadonlyMap<string, number> = new Map(BADGES.map((b, i) => [b.id, i]))

/** True for an id this build knows (rows written by a newer or older version may carry others). */
export function isBadgeId(value: string): value is BadgeId {
  return META_BY_ID.has(value)
}

/** The metadata of a known badge id, else `undefined`. */
export function badgeMeta(id: string): BadgeMeta | undefined {
  return META_BY_ID.get(id)
}

// ─── Input ──────────────────────────────────────────────────────────────────

export type BadgeSessionRow = Pick<
  Session,
  'id' | 'kind' | 'status' | 'counted' | 'day' | 'startedAt' | 'endedAt' | 'actualMinutes'
>
export type BadgeCourseRow = Pick<
  Milestone,
  'id' | 'goalId' | 'kind' | 'code' | 'title' | 'status' | 'termId' | 'completedAt' | 'updatedAt'
>
export type BadgeGoalRow = Pick<Goal, 'id' | 'terms'>

/**
 * How one calendar day stands in the streak:
 * - `qualified`: a counted session (or the daily goal) happened; adds 1 to the run.
 * - `frozen`: a streak freeze covered it; keeps the run alive without adding to it.
 * - `missed`: a finished day with no qualifying activity and no freeze; the run ends.
 * - `open`: today, still in progress; changes nothing.
 */
export type BadgeStreakStatus = 'qualified' | 'frozen' | 'missed' | 'open'

export interface BadgeStreakDay {
  day: ISODate
  status: BadgeStreakStatus
}

/** The streak as day statuses in calendar order. A calendar day missing between two entries counts as missed. */
export interface BadgeStreak {
  days: readonly BadgeStreakDay[]
}

export interface BadgeInput {
  sessions: readonly BadgeSessionRow[]
  /** Every course and milestone row; only `kind: 'course'` counts. */
  courses: readonly BadgeCourseRow[]
  goals: readonly BadgeGoalRow[]
  streak: BadgeStreak
}

export interface BadgeUnlock {
  id: BadgeId
  unlockedAt: Millis
  /** A short note about what earned it ("Started at 07:30"), shown in the tooltip. */
  context: string | null
}

// ─── The streak seam (Phase 7 replaces this) ────────────────────────────────

/**
 * Turns `streakDays` rows into the day-by-day state the badges read. Days from the first row through
 * `today`: a row with `qualified` is `qualified`; anything else before today is `missed`; today without a
 * qualifying row is `open` (it is not over yet). There are no freezes yet: Phase 7's streak engine will
 * replace this function and return `frozen` days too; nothing else here changes.
 */
export function computeStreakForBadges(
  rows: readonly Pick<StreakDay, 'day' | 'qualified'>[],
  today: ISODate,
): BadgeStreak {
  const byDay = new Map<ISODate, boolean>()
  for (const row of rows) {
    if (!isISODate(row.day) || row.day > today) continue
    byDay.set(row.day, (byDay.get(row.day) ?? false) || row.qualified)
  }
  if (byDay.size === 0) return { days: [] }
  const first = [...byDay.keys()].reduce((a, b) => (b < a ? b : a))
  return {
    days: eachDay(first, today).map((day) => ({
      day,
      status: byDay.get(day) ? 'qualified' : day === today ? 'open' : 'missed',
    })),
  }
}

// ─── Sessions ───────────────────────────────────────────────────────────────

interface CountedSession {
  id: ID
  day: ISODate
  startedAt: Millis
  endedAt: Millis
  minutes: number
}

/** Counted focus sessions in the order they ended. */
function countedSessions(rows: readonly BadgeSessionRow[]): CountedSession[] {
  return rows
    .filter((s) => s.kind === 'focus' && s.status === 'completed' && s.counted)
    .map((s) => ({
      id: s.id,
      day: s.day,
      startedAt: s.startedAt,
      endedAt: Math.max(s.endedAt ?? s.startedAt, s.startedAt),
      minutes: Math.max(0, Math.floor(s.actualMinutes ?? 0)),
    }))
    .sort((a, b) => a.endedAt - b.endedAt || a.startedAt - b.startedAt || a.id.localeCompare(b.id))
}

const shortDay = (day: ISODate): string => format(fromISODate(day), 'MMM d')
const clock = (ms: Millis): string => format(ms, 'HH:mm')

function firstFocus(sessions: readonly CountedSession[]): BadgeUnlock | null {
  const s = sessions[0]
  return s
    ? {
        id: 'first-focus',
        unlockedAt: s.endedAt,
        context: `${s.minutes} min on ${shortDay(s.day)}`,
      }
    : null
}

function earlyBird(sessions: readonly CountedSession[]): BadgeUnlock | null {
  const s = sessions.find((x) => getHours(x.startedAt) < EARLY_BIRD_BEFORE_HOUR)
  return s
    ? { id: 'early-bird', unlockedAt: s.endedAt, context: `Started at ${clock(s.startedAt)}` }
    : null
}

function nightOwl(sessions: readonly CountedSession[]): BadgeUnlock | null {
  const s = sessions.find((x) => {
    const hour = getHours(x.startedAt)
    return hour >= NIGHT_OWL_FROM_HOUR || hour < NIGHT_OWL_BEFORE_HOUR
  })
  return s
    ? { id: 'night-owl', unlockedAt: s.endedAt, context: `Started at ${clock(s.startedAt)}` }
    : null
}

/** The first moment any single day reached its 4th counted session. */
function deepWork(sessions: readonly CountedSession[]): BadgeUnlock | null {
  const perDay = new Map<ISODate, CountedSession[]>()
  for (const s of sessions) {
    const list = perDay.get(s.day)
    if (list) list.push(s)
    else perDay.set(s.day, [s])
  }
  let best: { at: Millis; day: ISODate } | null = null
  for (const [day, list] of perDay) {
    const fourth = list[DEEP_WORK_SESSIONS - 1]
    if (fourth && (best === null || fourth.endedAt < best.at)) best = { at: fourth.endedAt, day }
  }
  return best
    ? {
        id: 'deep-work',
        unlockedAt: best.at,
        context: `${DEEP_WORK_SESSIONS} sessions on ${shortDay(best.day)}`,
      }
    : null
}

/** The session whose minutes carried the running total to 6,000. */
function hours100(sessions: readonly CountedSession[]): BadgeUnlock | null {
  let total = 0
  for (const s of sessions) {
    total += s.minutes
    if (total >= HOURS_100_MINUTES) {
      return { id: 'hours-100', unlockedAt: s.endedAt, context: '100 hours of focus' }
    }
  }
  return null
}

// ─── Courses and terms ──────────────────────────────────────────────────────

/** When a done course was finished; a course marked done without a stamp falls back to its last edit. */
const doneAt = (c: BadgeCourseRow): Millis => c.completedAt ?? c.updatedAt
const isCourse = (c: BadgeCourseRow): boolean => c.kind === 'course'

function firstCourse(courses: readonly BadgeCourseRow[]): BadgeUnlock | null {
  let first: BadgeCourseRow | null = null
  for (const c of courses) {
    if (isCourse(c) && c.status === 'done' && (first === null || doneAt(c) < doneAt(first))) {
      first = c
    }
  }
  return first
    ? { id: 'first-course', unlockedAt: doneAt(first), context: first.code ?? first.title }
    : null
}

/**
 * A term is complete when it has at least one course assigned (`termId`) and every one of them is done.
 * Returns the earliest such moment: when the last of that term's courses was finished.
 */
function termComplete(
  courses: readonly BadgeCourseRow[],
  goals: readonly BadgeGoalRow[],
): BadgeUnlock | null {
  let best: { at: Millis; label: string } | null = null
  for (const goal of goals) {
    for (const term of goal.terms) {
      const members = courses.filter(
        (c) => isCourse(c) && c.goalId === goal.id && c.termId === term.id,
      )
      if (members.length === 0 || members.some((c) => c.status !== 'done')) continue
      const at = members.reduce((latest, c) => Math.max(latest, doneAt(c)), 0)
      if (best === null || at < best.at) best = { at, label: term.label }
    }
  }
  return best ? { id: 'term-complete', unlockedAt: best.at, context: best.label } : null
}

// ─── Streaks ────────────────────────────────────────────────────────────────

/**
 * Walks the streak day by day. `run` counts qualified days since the streak last ended: a frozen day
 * keeps it alive without adding, a missed day (or a calendar day absent from the list) ends it, and
 * `open` (today) leaves it alone. A comeback needs an earlier run of at least 3 to have ended on a
 * missed day (never on a frozen one), and then 3 qualified days in the new run.
 * `momentOf` is when a day qualified: its first counted session's end, else the start of that day.
 */
function streakUnlocks(streak: BadgeStreak, momentOf: (day: ISODate) => Millis): BadgeUnlock[] {
  const byDay = new Map<ISODate, BadgeStreakDay>()
  for (const d of streak.days) if (isISODate(d.day)) byDay.set(d.day, d)
  const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))

  const found = new Map<BadgeId, BadgeUnlock>()
  let run = 0
  let runStart: ISODate | null = null
  let earlierStreakEnded = false
  let previous: ISODate | null = null

  for (const entry of days) {
    const gap = previous !== null && diffDays(entry.day, previous) > 1
    previous = entry.day
    if (gap || entry.status === 'missed') {
      if (run >= COMEBACK_MIN_STREAK) earlierStreakEnded = true
      run = 0
      runStart = null
    }
    if (entry.status !== 'qualified') continue

    if (run === 0) runStart = entry.day
    run += 1
    const unlockedAt = momentOf(entry.day)
    const range = `${shortDay(runStart ?? entry.day)} – ${shortDay(entry.day)}`
    for (const badge of STREAK_BADGES) {
      if (run === badge.days && !found.has(badge.id)) {
        found.set(badge.id, { id: badge.id, unlockedAt, context: range })
      }
    }
    if (earlierStreakEnded && run === COMEBACK_RUN && !found.has('comeback')) {
      found.set('comeback', {
        id: 'comeback',
        unlockedAt,
        context: `Back on ${shortDay(entry.day)} after a break`,
      })
    }
  }
  return [...found.values()]
}

// ─── Evaluate ───────────────────────────────────────────────────────────────

/**
 * Every badge the history has earned, each with the moment its condition first became true, oldest first.
 * Pure and repeatable: run it on more data later and the earlier unlocks come back unchanged.
 */
export function evaluateBadges(input: BadgeInput): BadgeUnlock[] {
  const sessions = countedSessions(input.sessions)

  // A day "qualified" when its first counted session ended.
  const firstEnd = new Map<ISODate, Millis>()
  for (const s of sessions) if (!firstEnd.has(s.day)) firstEnd.set(s.day, s.endedAt)
  const momentOf = (day: ISODate): Millis => firstEnd.get(day) ?? dayStartMs(day)

  const unlocks: BadgeUnlock[] = []
  for (const u of [
    firstFocus(sessions),
    earlyBird(sessions),
    nightOwl(sessions),
    deepWork(sessions),
    hours100(sessions),
    firstCourse(input.courses),
    termComplete(input.courses, input.goals),
  ]) {
    if (u) unlocks.push(u)
  }
  unlocks.push(...streakUnlocks(input.streak, momentOf))

  return unlocks.sort(
    (a, b) =>
      a.unlockedAt - b.unlockedAt || (ORDER_BY_ID.get(a.id) ?? 0) - (ORDER_BY_ID.get(b.id) ?? 0),
  )
}

// ─── Display ────────────────────────────────────────────────────────────────

export type StoredBadge = Pick<Badge, 'id' | 'unlockedAt' | 'context'>

export interface BadgeState extends BadgeMeta {
  unlocked: boolean
  unlockedAt: Millis | null
  context: string | null
}

/** Every known badge in the brief's order, with the stored unlock (if any) merged in. */
export function badgeStates(stored: readonly StoredBadge[]): BadgeState[] {
  const byId = new Map(stored.map((b) => [b.id, b]))
  return BADGES.map((meta) => {
    const row = byId.get(meta.id)
    return {
      ...meta,
      unlocked: row !== undefined,
      unlockedAt: row?.unlockedAt ?? null,
      context: row?.context ?? null,
    }
  })
}

/** "6 of 11 unlocked". */
export function unlockSummary(states: readonly BadgeState[]): string {
  return `${states.filter((s) => s.unlocked).length} of ${states.length} unlocked`
}

/** The most recently unlocked badges, newest first. */
export function recentBadges(stored: readonly StoredBadge[], limit: number): BadgeState[] {
  return badgeStates(stored)
    .filter((s) => s.unlocked)
    .sort(
      (a, b) =>
        (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0) ||
        (ORDER_BY_ID.get(a.id) ?? 0) - (ORDER_BY_ID.get(b.id) ?? 0),
    )
    .slice(0, Math.max(0, limit))
}

/** "Sep 29", or "Sep 29, 2025" when it was not this year. */
export function formatUnlockDate(at: Millis, now: Millis): string {
  return format(at, getYear(at) === getYear(now) ? 'MMM d' : 'MMM d, yyyy')
}

/** "Tuesday, September 29, 2026", for tooltips. */
export function formatUnlockDateLong(at: Millis): string {
  return format(at, 'EEEE, MMMM d, yyyy')
}
