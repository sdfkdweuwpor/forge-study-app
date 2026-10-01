/**
 * Domain handlers and start-up work for streaks (Phase 7A).
 *
 * `streakDays` is a cache of what each day held, so every trigger does the same thing: recompute the
 * affected day from the source of truth (`refreshDay`), which is idempotent and writes only what
 * changed. The badge watcher follows the table, so a moving row reconciles badges by itself.
 *
 * - `session.ended` (counted): the day's row, then the milestone check. A streak milestone that pays
 *   XP right now is announced through `onStreakMilestones` (the toast); nothing is ever announced for
 *   history.
 * - `task.completed` / `task.uncompleted`: the day's tasks-done count.
 * - `xp.changed`: the day's XP (the milestone's own XP, the daily goal's, a task's).
 * - `settings.changed` (daily goal, pomodoro length): today's target and goal flag; the week start
 *   moves the freezes, so milestones are reconciled again (quietly). The goal is only one way to
 *   qualify (a counted session always does), so it never changes a streak.
 * - `sync.applied` (cloud sync brought rows from another device): the same full check the start-up makes,
 *   so `streakDays` and the badges those rows earn follow the synced history. Quiet like the start-up:
 *   no milestone XP is paid and nothing is announced for work done elsewhere.
 * - App start (and each midnight): `syncProgressAtStart` (the last three days, or the whole history the
 *   first time, after a schema change, an import or a restored backup) together with the badges those
 *   rows earn, in one transaction so the badge watcher stays quiet; then milestones for streaks that
 *   were never paid, silently.
 */
import { defineHandler, type DomainHandler } from '@/db/events'
import {
  reconcileStreakMilestones,
  refreshDay,
  syncProgressAtStart,
  type StreakMilestoneAward,
} from '@/db/repos/progress'
import type { ISODate, TableName } from '@/db/types'
import { dayOf } from '@/logic/dates'

// ─── Announcements ──────────────────────────────────────────────────────────

type MilestoneListener = (awards: readonly StreakMilestoneAward[]) => void
const listeners = new Set<MilestoneListener>()

/** Calls `listener` with each milestone a live event just paid (never for history). Returns unsubscribe. */
export function onStreakMilestones(listener: MilestoneListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function announce(awards: readonly StreakMilestoneAward[]): void {
  if (awards.length === 0) return
  for (const listener of [...listeners]) listener(awards)
}

/** Pays any milestone now reached and tells the toast. Concurrent calls are safe: each is paid once. */
export async function reconcileAndAnnounce(today: ISODate = dayOf(Date.now())): Promise<void> {
  announce(await reconcileStreakMilestones(today))
}

// ─── Handlers ───────────────────────────────────────────────────────────────

/**
 * Bookkeeping waits a moment before it reads and writes. A session ending or a task being finished
 * opens a dialog, a toast and a row animation, and those read the same tables; the streak's rows and
 * milestones are not urgent (a flame that moves a tenth of a second later is unnoticeable), so they go
 * second instead of competing with what the person is looking at.
 */
const YIELD_MS = 80
const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, YIELD_MS))

const sessionEnded = defineHandler({
  id: 'streaks.sessionEnded',
  event: 'session.ended',
  async handle(event) {
    // A session under the 80% rule earns nothing, so it changes no day.
    if (!event.counted) return
    await yieldToUi()
    await refreshDay(event.day)
    await reconcileAndAnnounce()
  },
})

const taskCompleted = defineHandler({
  id: 'streaks.taskCompleted',
  event: 'task.completed',
  async handle(event) {
    await yieldToUi()
    await refreshDay(event.day)
  },
})

const taskUncompleted = defineHandler({
  id: 'streaks.taskUncompleted',
  event: 'task.uncompleted',
  async handle(event) {
    await yieldToUi()
    await refreshDay(event.day)
  },
})

const xpChanged = defineHandler({
  id: 'streaks.xpChanged',
  event: 'xp.changed',
  async handle(event) {
    // A session's or a task's own XP is written in the transaction the other handlers already answer
    // (`session.ended`, `task.completed`), so their refresh has it. What arrives on its own is the
    // daily goal's bonus, a course, a ritual, an adjustment and the streak's milestone XP.
    if (event.source === 'session' || event.source === 'task') return
    await refreshDay(event.day)
  },
})

const settingsChanged = defineHandler({
  id: 'streaks.settingsChanged',
  event: 'settings.changed',
  async handle(event) {
    const goalOrTimer =
      event.sections.includes('dailyGoalPomodoros') || event.sections.includes('timer')
    if (goalOrTimer) await refreshDay(dayOf(Date.now()))
    // A different week start moves the freezes, which can move where a streak starts or ends.
    if (event.sections.includes('weekStartsOn')) {
      await reconcileStreakMilestones(dayOf(Date.now()))
    }
  },
})

/** Tables whose rows change what a day held (`planDays` reads them) or how it is read (week start, goal). */
const STREAK_INPUTS: ReadonlySet<TableName> = new Set<TableName>([
  'sessions',
  'tasks',
  'xpEvents',
  'settings',
])

const syncApplied = defineHandler({
  id: 'streaks.syncApplied',
  event: 'sync.applied',
  async handle(event) {
    if (!event.tables.some((t) => STREAK_INPUTS.has(t))) return
    const now = Date.now()
    await syncProgressAtStart({ today: dayOf(now), now, full: true })
  },
})

export const streakDomainHandlers: DomainHandler[] = [
  sessionEnded,
  taskCompleted,
  taskUncompleted,
  xpChanged,
  settingsChanged,
  syncApplied,
]

// ─── Start-up ───────────────────────────────────────────────────────────────

let verifiedThisLoad = false

/** Forgets that this page load has verified the rows (tests): the next start verifies everything again. */
export function forgetVerifiedStart(): void {
  verifiedThisLoad = false
}

/**
 * The feature's `onAppStart` (runs on load and at each local midnight): the rows and the badges they
 * earn (`syncProgressAtStart`), then any milestone XP not paid yet. The first start of a page load checks
 * the whole cache against the history (a raw write, an import or a sync may have added days the handlers
 * never saw; it costs tens of milliseconds and writes only what differs). Later starts (midnight) redo
 * the last three days, or everything when `needsFullRebuild` sees uncovered history. All of it is quiet.
 */
export async function streaksAppStart(ctx: { now: number; today: ISODate }): Promise<void> {
  const full = verifiedThisLoad ? undefined : true
  verifiedThisLoad = true
  await syncProgressAtStart({ ...ctx, full })
  await reconcileStreakMilestones(ctx.today)
}
