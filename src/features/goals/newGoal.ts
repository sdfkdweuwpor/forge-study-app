import { navigate } from '@/app/router'

/**
 * The one way into creating a goal: the "New goal" button, the `n` shortcut, the palette command and
 * the empty states all call this. It opens `/goals/new`, which shows the new-goal flow over the goals
 * list. The goal breakdown planner takes over by changing what that route renders (see `GoalsPage`);
 * nothing else needs to change.
 */
export function openNewGoalFlow(): void {
  navigate('goalNew')
}
