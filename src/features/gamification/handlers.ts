/**
 * Domain handlers and start-up work for XP and levels (Phase 6A).
 *
 * - Daily goal: when a counted focus session ends, the day's counted pomodoros are checked against
 *   `settings.dailyGoalPomodoros` (the same count the goal ring shows), and +25 XP is awarded once per
 *   day under the key `dailyGoal:<day>`. The award is idempotent, so a repeated event, a second tab or
 *   the start-up reconcile can never pay it twice.
 * - Start-up: remember the level the app opens at when none was ever recorded (so sample or imported
 *   data does not throw a celebration), then reconcile the daily goal for yesterday and today (a
 *   session can end while no tab is open to run the handler).
 */
import { defineHandler } from '@/db/events'
import { initCelebratedLevel } from '@/db/repos/levels'
import { getXpSummary } from '@/db/repos/xp'
import type { ISODate } from '@/db/types'

// The daily goal repository (and the day and XP rules behind it) loads with the first session end or app
// start, not with the app's first download.
const dailyGoalRepo = () => import('@/db/repos/dailyGoal')

/** `session.ended` → the daily-goal bonus, when this session is the one that reaches the goal. */
export const dailyGoalHandler = defineHandler({
  id: 'gamification.dailyGoal',
  event: 'session.ended',
  async handle(event) {
    // A session that did not count is not a pomodoro, so it cannot be the one that reaches the goal.
    if (!event.counted) return
    const { awardDailyGoal } = await dailyGoalRepo()
    await awardDailyGoal(event.day)
  },
})

/** Records the current level as already celebrated when nothing was recorded yet. */
export async function rememberStartingLevel(today: ISODate): Promise<void> {
  const summary = await getXpSummary(today)
  await initCelebratedLevel(summary.level.level)
}

/** The feature's `onAppStart`: the starting level first, then the daily goal for yesterday and today. */
export async function gamificationAppStart(ctx: { today: ISODate }): Promise<void> {
  await rememberStartingLevel(ctx.today)
  const { reconcileDailyGoal } = await dailyGoalRepo()
  await reconcileDailyGoal(ctx.today)
}
