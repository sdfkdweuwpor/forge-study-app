/**
 * The weekly review (BRIEF §5.7, PLAN Phase 7C): one `weeklyReviews` row per week (`id` = the week's
 * first day) holding the person's own words for "what got in the way?" and the moment they marked the
 * review done, plus the read that gathers what the page shows.
 *
 * - The text autosaves through `saveReviewNote` and never touches `completedAt`, so writing after the
 *   review is done changes nothing else.
 * - `completeWeeklyReview` marks the week done and pays the ritual XP (+10) under the key
 *   `review:<weekStart>`, in one transaction. It is idempotent: a second call, another tab or a repeat
 *   after an undo of nothing pays nothing more and keeps the first `completedAt`.
 * - `loadReviewInput` reads everything `buildWeeklyReview` needs in one read-only transaction (a
 *   consistent snapshot; it never blocks a writer). Numbers come from counted focus sessions and
 *   finished tasks, like the Progress page, and the streak from the `streakDays` rows through the
 *   streak engine (as it stood at the end of that week).
 */
import { addDays } from '@/logic/dates'
import { countedMinutes, type NamedRef, type StatSession, type StatTask } from '@/logic/stats'
import { SCAN_DAYS, computeStreak } from '@/logic/streaks'
import { planDay } from '@/logic/taskDates'
import { tagColor } from '@/logic/tagColor'
import {
  XP_WEEKLY_REVIEW,
  reviewWeekEnd,
  reviewXpKey,
  type ReviewBadge,
  type ReviewCourse,
  type ReviewPlannedItem,
  type WeeklyReviewInput,
} from '@/logic/weeklyReview'
import { db } from '../db'
import type { ISODate, Millis, TagColor, Task, WeeklyReview, XpEvent } from '../types'
import { getSettings } from './settings'
import { awardXp } from './xp'

export interface ReviewOptions {
  /** Injected clock for tests; defaults to `Date.now()`. */
  now?: Millis
}

// ─── The row ────────────────────────────────────────────────────────────────

/** The stored review of a week, or `undefined` when nothing was written for it yet. */
export function getWeeklyReview(weekStart: ISODate): Promise<WeeklyReview | undefined> {
  return db.weeklyReviews.get(weekStart)
}

/** Whether the review of that week has been marked done. */
export async function isReviewDone(weekStart: ISODate): Promise<boolean> {
  return (await db.weeklyReviews.get(weekStart))?.completedAt != null
}

function blankRow(weekStart: ISODate, now: Millis): WeeklyReview {
  return { id: weekStart, createdAt: now, updatedAt: now, weekStart, wins: '', blockers: '', completedAt: null }
}

/**
 * Saves the "what got in the way?" text for a week (creating the row on the first word). Nothing else
 * on the row changes, so it is safe to call after every pause in typing. Returns the saved row.
 */
export async function saveReviewNote(
  weekStart: ISODate,
  text: string,
  opts: ReviewOptions = {},
): Promise<WeeklyReview> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.weeklyReviews, async () => {
    const before = await db.weeklyReviews.get(weekStart)
    const row: WeeklyReview = { ...(before ?? blankRow(weekStart, now)), blockers: text, updatedAt: now }
    await db.weeklyReviews.put(row)
    return row
  })
}

export interface CompletedReview {
  row: WeeklyReview
  /** The XP event paid now, or `null` when this week's review had already paid it. */
  xp: XpEvent | null
}

/**
 * Marks a week's review done and pays +10 XP once (`review:<weekStart>`). `wins` is a snapshot of the
 * lines the page showed, kept with the row. A second call keeps the first `completedAt` and its wins and
 * pays nothing.
 */
export async function completeWeeklyReview(
  weekStart: ISODate,
  wins: readonly string[],
  opts: ReviewOptions = {},
): Promise<CompletedReview> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', [db.weeklyReviews, db.xpEvents], async () => {
    const before = await db.weeklyReviews.get(weekStart)
    const row: WeeklyReview =
      before?.completedAt != null
        ? before
        : { ...(before ?? blankRow(weekStart, now)), wins: wins.join('\n'), completedAt: now, updatedAt: now }
    if (row !== before) await db.weeklyReviews.put(row)
    const xp = await awardXp({
      source: 'ritual',
      amount: XP_WEEKLY_REVIEW,
      key: reviewXpKey(weekStart),
      note: 'Weekly review',
      at: now,
    })
    return { row, xp }
  })
}

// ─── The read ───────────────────────────────────────────────────────────────

const toStatSession = (s: StatSession): StatSession => ({
  id: s.id,
  kind: s.kind,
  status: s.status,
  counted: s.counted,
  day: s.day,
  startedAt: s.startedAt,
  endedAt: s.endedAt,
  actualMinutes: s.actualMinutes,
  pausedMs: s.pausedMs,
  taskId: s.taskId,
  goalId: s.goalId,
  milestoneId: s.milestoneId,
})

const toStatTask = (t: StatTask): StatTask => ({
  id: t.id,
  status: t.status,
  completedAt: t.completedAt,
  completedDay: t.completedDay,
  estimatePomodoros: t.estimatePomodoros,
})

/** A tag colour for a chart bar: red reads as an alarm and a bar is never that, so it becomes pink. */
const chartColor = (color: TagColor): TagColor => (color === 'red' ? 'pink' : color)

/** How long an open task is planned to take: its slot, else its estimate, else nothing (it still counts). */
export function plannedMinutesOf(
  task: Pick<Task, 'durationMinutes' | 'estimateMinutes' | 'estimatePomodoros'>,
  pomodoroMin: number,
): number {
  if ((task.durationMinutes ?? 0) > 0) return task.durationMinutes ?? 0
  if ((task.estimateMinutes ?? 0) > 0) return task.estimateMinutes ?? 0
  if ((task.estimatePomodoros ?? 0) > 0) return (task.estimatePomodoros ?? 0) * pomodoroMin
  return 0
}

/**
 * Everything the review of the week starting `weekStart` reads, in one snapshot. `today` is the app's
 * day (it decides how far the streak is read: to the end of a past week, to today for the current one).
 */
export async function loadReviewInput(
  weekStart: ISODate,
  today: ISODate,
): Promise<WeeklyReviewInput> {
  const weekEnd = reviewWeekEnd(weekStart)
  const from = addDays(weekStart, -7)
  const nextFrom = addDays(weekStart, 7)
  const nextTo = addDays(weekStart, 13)

  return db.transaction(
    'r',
    [db.settings, db.sessions, db.tasks, db.goals, db.milestones, db.badges, db.streakDays],
    async () => {
      const settings = await getSettings()
      const asOf = today < weekEnd ? today : weekEnd
      const [sessions, done, goals, badges, courses, byDo, byDue, streakRows] = await Promise.all([
        db.sessions.where('[kind+day]').between(['focus', from], ['focus', weekEnd], true, true).toArray(),
        db.tasks.where('completedDay').between(from, weekEnd, true, true).toArray(),
        db.goals.toArray(),
        db.badges.toArray(),
        db.milestones.where('status').equals('done').toArray(),
        db.tasks.where('doDate').between(nextFrom, nextTo, true, true).toArray(),
        db.tasks.where('dueDate').between(nextFrom, nextTo, true, true).toArray(),
        db.streakDays.where('id').aboveOrEqual(addDays(today, -(SCAN_DAYS + 1))).toArray(),
      ])

      // The streak as it stood when the week ended, and (for a past week) how its days stand now.
      const atEnd = computeStreak(streakRows, asOf, settings.weekStartsOn)
      const now = asOf === today ? atEnd : computeStreak(streakRows, today, settings.weekStartsOn)

      const refs: NamedRef[] = goals.map((g) => ({
        id: g.id,
        title: g.title,
        color: chartColor(tagColor(g.title, settings.tagColors)),
      }))
      const reviewBadges: ReviewBadge[] = badges.map((b) => ({ id: b.id, unlockedAt: b.unlockedAt }))
      const reviewCourses: ReviewCourse[] = courses
        .filter((m) => m.kind === 'course' && m.completedAt !== null)
        .map((m) => ({ code: m.code, title: m.title, completedAt: m.completedAt ?? 0 }))

      // Open tasks planned for each day: a do date, else the deadline; a task found by both is one.
      const seen = new Set<string>()
      const planned: ReviewPlannedItem[] = []
      for (const t of [...byDo, ...byDue]) {
        if (t.status === 'done' || seen.has(t.id)) continue
        const day = planDay(t)
        if (day === null || day < nextFrom || day > nextTo) continue
        seen.add(t.id)
        planned.push({ day, minutes: plannedMinutesOf(t, settings.timer.pomodoroMin) })
      }

      return {
        weekStart,
        weekStartsOn: settings.weekStartsOn,
        today,
        sessions: sessions.filter((s) => countedMinutes(s) > 0).map(toStatSession),
        tasks: done.filter((t) => t.status === 'done').map(toStatTask),
        goals: refs,
        streak: { current: atEnd.current, best: atEnd.best },
        streakDays: now.days,
        badges: reviewBadges,
        courses: reviewCourses,
        planned,
      }
    },
  )
}
