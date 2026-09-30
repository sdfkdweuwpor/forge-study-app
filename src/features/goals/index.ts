/**
 * Public API of the goals feature. Other features import from `@/features/goals` only.
 *
 * - `openNewGoalFlow()` / `NewGoalButton`: the single entry point for creating a goal (the goal
 *   breakdown planner at `/goals/new`).
 */
export { openNewGoalFlow } from './newGoal'
export { NewGoalButton } from './NewGoalButton'
