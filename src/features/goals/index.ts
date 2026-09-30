/**
 * Public API of the goals feature. Other features import from `@/features/goals` only.
 *
 * - `openNewGoalFlow()` / `NewGoalButton`: the single entry point for creating a goal. The goal breakdown
 *   planner replaces what `/goals/new` shows and keeps these.
 */
export { openNewGoalFlow } from './newGoal'
export { NewGoalButton } from './NewGoalButton'
