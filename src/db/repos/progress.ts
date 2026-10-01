/**
 * Progress rows and the streak (BRIEF §5.7, PLAN Phase 7A).
 *
 * `streakDays` is a rebuildable daily cache. `rebuildDays(from, to)` recomputes each day from the
 * source of truth (counted focus sessions, finished tasks, XP events and the daily goal) and writes
 * only the rows that changed, in one transaction, so it can run after any change, from any tab, any
 * number of times, and gives the same rows. Nothing here emits an event: the badge watcher already
 * follows the table (`watchStreakDays`), so a row that moves reconciles badges by itself.
 *
 * The streak itself is never stored: `loadStreak` reads the rows and runs `computeStreak`
 * (`@/logic/streaks`), so the weekly freeze, milestones and best streak are always consistent with
 * the days. Milestone XP (7 / 30 / 100 days = 100 / 500 / 2000) is awarded once per key
 * `streak:<days>:<first day of that streak>`; `awardXp` is idempotent, so reconciling is safe to repeat.
 */
import { addDays, dayOf } from '@/logic/dates'
import {
  SCAN_DAYS,
  computeStreak,
  type StreakMilestoneReached,
  type StreakResult,
} from '@/logic/streaks'
import {
  buildStreakDays,
  hasCurrentShape,
  sameDayValues,
  type StreakDayValues,
} from '@/logic/streakDays'
import { xpForStreakMilestone } from '@/logic/xp'
import { db } from '../db'
import type { ISODate, Millis, StreakDay, XpEvent } from '../types'
import { reconcileBadges } from './badges'
import { getSettings } from './settings'
import { awardXp } from './xp'

export interface RebuildOptions {
  /** The day the app is on (default: the local day now). Past days keep their daily-goal snapshot. */
  today?: ISODate
}

export interface RebuildResult {
  /** Rows inserted or changed. */
  written: number
  /** Rows removed because their day no longer has any activity. */
  removed: number
}

const PROGRESS_TABLES = () => [db.streakDays, db.sessions, db.tasks, db.xpEvents, db.settings]

interface Plan {
  upserts: StreakDay[]
  removals: ISODate[]
}

const NOTHING: Plan = { upserts: [], removals: [] }

/**
 * Reads the sources for `[from, to]` and works out which rows to write and which to remove. Read-only,
 * so it can run in a read transaction (it never holds up a writer of sessions or tasks) or inside a
 * larger one.
 */
async function planDays(from: ISODate, to: ISODate, today: ISODate, now: Millis): Promise<Plan> {
  if (from > to) return NOTHING
  const [settings, sessions, tasks, xpEvents, stored] = await Promise.all([
    getSettings(),
    db.sessions.where('[kind+day]').between(['focus', from], ['focus', to], true, true).toArray(),
    db.tasks.where('completedDay').between(from, to, true, true).toArray(),
    db.xpEvents.where('day').between(from, to, true, true).toArray(),
    db.streakDays.where('id').between(from, to, true, true).toArray(),
  ])
  const existing = new Map<ISODate, StreakDay>(stored.map((row) => [row.id, row]))
  const rows = buildStreakDays(
    from,
    to,
    { sessions, tasks, xpEvents },
    {
      today,
      pomodoroMin: settings.timer.pomodoroMin,
      dailyGoalPomodoros: settings.dailyGoalPomodoros,
      existing,
    },
  )

  const upserts: StreakDay[] = []
  for (const [day, values] of rows) {
    const before = existing.get(day)
    if (before && hasCurrentShape(before) && sameDayValues(before, values)) continue
    upserts.push(toRow(values, before, now))
  }
  const removals = stored.filter((row) => !rows.has(row.id)).map((row) => row.id)
  return { upserts, removals }
}

function toRow(values: StreakDayValues, before: StreakDay | undefined, now: Millis): StreakDay {
  return { ...values, id: values.day, createdAt: before?.createdAt ?? now, updatedAt: now }
}

async function applyPlan(plan: Plan): Promise<RebuildResult> {
  if (plan.upserts.length > 0) await db.streakDays.bulkPut(plan.upserts)
  if (plan.removals.length > 0) await db.streakDays.bulkDelete(plan.removals)
  return { written: plan.upserts.length, removed: plan.removals.length }
}

/**
 * Rebuilds run one at a time in this tab, so two handlers reacting to one change (a session ending
 * and its XP) cannot interleave a stale read with a newer write of the same day. A request for a range
 * that is already waiting its turn shares that run (it has not read anything yet, so it will see this
 * change too); a request while the same range is running queues a fresh one.
 */
let queue: Promise<unknown> = Promise.resolve()
const waiting = new Map<string, Promise<RebuildResult>>()

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * Two short transactions: a read-only one to plan (concurrent with everything that only reads, and it
 * never blocks a session or task write) and a read-write one on `streakDays` alone to apply.
 */
function rebuild(
  key: string,
  range: () => Promise<[ISODate, ISODate] | null>,
  today: ISODate,
): Promise<RebuildResult> {
  const queued = waiting.get(key)
  if (queued) return queued
  const run = serialized(async (): Promise<RebuildResult> => {
    waiting.delete(key)
    const now = Date.now()
    const plan = await db.transaction('r', PROGRESS_TABLES(), async () => {
      const window = await range()
      return window ? planDays(window[0], window[1], today, now) : NOTHING
    })
    if (plan.upserts.length === 0 && plan.removals.length === 0) return { written: 0, removed: 0 }
    return db.transaction('rw', db.streakDays, () => applyPlan(plan))
  })
  waiting.set(key, run)
  return run
}

/**
 * Recomputes the `streakDays` rows for every day in `[from, to]` (inclusive) from sessions, finished
 * tasks, XP and the daily goal. A day with no activity has no row; a stored row whose day went quiet
 * is removed. Only rows that differ are written, so a second run writes nothing.
 */
export function rebuildDays(
  from: ISODate,
  to: ISODate,
  opts: RebuildOptions = {},
): Promise<RebuildResult> {
  const today = opts.today ?? dayOf(Date.now())
  return rebuild(`${from}|${to}|${today}`, async () => [from, to], today)
}

/** Recomputes one day. What a domain handler calls after a session, task or XP change. */
export function refreshDay(day: ISODate, opts: RebuildOptions = {}): Promise<RebuildResult> {
  return rebuildDays(day, day, opts)
}

/** The earliest day anything could have written a row for: counted sessions, finished tasks, stored rows. */
async function earliestSourceDay(): Promise<ISODate | null> {
  const [session, task, row] = await Promise.all([
    db.sessions
      .where('[kind+day]')
      .between(['focus', ''], ['focus', '\uffff'], true, true)
      .filter((s) => s.status === 'completed' && s.counted)
      .first(),
    db.tasks
      .where('completedDay')
      .above('')
      .filter((t) => t.status === 'done')
      .first(),
    db.streakDays.orderBy('id').first(),
  ])
  const days = [session?.day, task?.completedDay, row?.id].filter(
    (d): d is ISODate => typeof d === 'string',
  )
  return days.length === 0 ? null : days.reduce((a, b) => (b < a ? b : a))
}

/**
 * Whether the rows should be rebuilt from the beginning: the history has activity older than the
 * oldest stored row (first run of this feature, an import or a restored backup), or a stored row has
 * an older shape (a schema change). Reads a handful of rows; cheap enough for every app start.
 */
export async function needsFullRebuild(): Promise<boolean> {
  const [rows, earliest] = await Promise.all([db.streakDays.toArray(), earliestSourceDay()])
  if (rows.some((row) => !hasCurrentShape(row))) return true
  if (earliest === null) return false
  const oldestRow = rows.reduce<ISODate | null>((a, r) => (a === null || r.id < a ? r.id : a), null)
  return oldestRow === null || earliest < oldestRow
}

/** The whole range: from the earliest activity through `today` (`null` when there is none). */
async function wholeHistory(today: ISODate): Promise<[ISODate, ISODate] | null> {
  const earliest = await earliestSourceDay()
  return earliest === null ? null : [earliest < today ? earliest : today, today]
}

/** Rebuilds every row from the earliest activity through `today`. */
export function rebuildAll(opts: RebuildOptions = {}): Promise<RebuildResult> {
  const today = opts.today ?? dayOf(Date.now())
  return rebuild(`all|${today}`, () => wholeHistory(today), today)
}

/**
 * What app start does to the rows: everything (`full`, or when `needsFullRebuild()` says the history
 * holds days the rows do not cover), else the last three days (a session can end while no tab is
 * open). The badges those rows earn are credited in the same transaction, so the badge watcher (which
 * reacts to the rows moving) finds them already there and says nothing: history is never announced as
 * if it were news. Returns whether it was a full rebuild.
 */
export async function syncProgressAtStart(ctx: {
  today: ISODate
  now: Millis
  /** Rebuild everything. Omit to decide from the data (`needsFullRebuild`). */
  full?: boolean
}): Promise<{ full: boolean } & RebuildResult> {
  const full = ctx.full ?? (await needsFullRebuild())
  return serialized(() =>
    db.transaction('rw', [...PROGRESS_TABLES(), db.milestones, db.goals, db.badges], async () => {
      const window = full
        ? await wholeHistory(ctx.today)
        : ([addDays(ctx.today, -2), ctx.today] as const)
      const plan = window ? await planDays(window[0], window[1], ctx.today, ctx.now) : NOTHING
      const result = await applyPlan(plan)
      if (result.written > 0 || result.removed > 0) await reconcileBadges(ctx.now)
      return { full, ...result }
    }),
  )
}

// ─── The streak ─────────────────────────────────────────────────────────────

/** The streak as of `today`: rows in, `computeStreak` out. Live-query safe (it only reads). */
export async function loadStreak(today: ISODate): Promise<StreakResult> {
  const [settings, rows] = await Promise.all([
    getSettings(),
    // One day before the scan window, so a streak that runs into it is recognised as clipped.
    db.streakDays
      .where('id')
      .aboveOrEqual(addDays(today, -(SCAN_DAYS + 1)))
      .toArray(),
  ])
  return computeStreak(rows, today, settings.weekStartsOn)
}

/** A streak milestone whose XP was just paid. */
export interface StreakMilestoneAward {
  milestone: StreakMilestoneReached
  /** XP paid: 100, 500 or 2000. */
  xp: number
  event: XpEvent
}

/**
 * Pays the XP for every milestone the streaks in the scan have reached and that has not been paid yet
 * (7 days = 100 XP, 30 = 500, 100 = 2000), dated to the day it was reached. Idempotent per milestone
 * key, so it can run after every session and at every app start; it returns only what it paid now,
 * oldest first. Nothing is ever taken back: a milestone reached stays reached.
 */
export async function reconcileStreakMilestones(today: ISODate): Promise<StreakMilestoneAward[]> {
  const streak = await loadStreak(today)
  const awards: StreakMilestoneAward[] = []
  for (const milestone of streak.milestonesReached) {
    const xp = xpForStreakMilestone(milestone.days)
    const event = await awardXp({
      source: 'streak',
      amount: xp,
      key: milestone.key,
      note: `${milestone.days}-day streak`,
      day: milestone.on,
    })
    if (event) awards.push({ milestone, xp, event })
  }
  return awards
}
