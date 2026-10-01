import { navigate } from '@/app/router'

/**
 * The one way into creating a goal: the "New goal" button, the `n` shortcut, the palette command and
 * the empty states all call this. It opens `/goals/new`, the goal breakdown planner (`features/planner`,
 * which the goals feature lazy-loads for that route). Nothing else needs to change if the flow does.
 */
export function openNewGoalFlow(): void {
  navigate('goalNew')
}
