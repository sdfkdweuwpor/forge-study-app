/**
 * Public API of the Today feature. Other features import from `@/features/today` only.
 *
 * - `useNowTask()`: the single task to do next (`pickNow`), live.
 * - `startFocus(task)`: the one seam for "Start focus". Phase 3 opens `/focus?task=<id>`; Phase 4
 *   replaces its body to start the session first.
 * - `TodayStat`: one figure of the stat row, for contributions to the `today.header` slot.
 * - `requestTodayAction(action)`: what the palette commands use to complete or skip the Now task
 *   from any page.
 */
export { useNowTask } from './queries'
export { startFocus } from './startFocus'
export { TodayStat } from './Stat'
export type { TodayStatProps } from './Stat'
export { requestTodayAction } from './todayActions'
export type { TodayAction } from './todayActions'
