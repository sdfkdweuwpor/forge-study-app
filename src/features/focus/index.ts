/**
 * Public API of the focus feature. Other features import from `@/features/focus` only.
 *
 * - `beginFocus({ taskId })`: starts a focus session (the timer) and opens the Focus page. The Today
 *   screen's "Start focus" and the tasks' `s` key call it.
 * - `useTimer()`: the ticking view of the running session (status, whole seconds on screen, progress).
 */
export { beginFocus } from './actions'
export type { BeginOptions } from './actions'
export { useTimer } from './useTimer'
export type { TimerSnapshot, TimerStatus } from './timerStore'
