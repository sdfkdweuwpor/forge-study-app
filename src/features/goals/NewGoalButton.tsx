import { Plus } from 'lucide-react'
import { Button } from '@/ui/Button'
import { openNewGoalFlow } from './newGoal'

/** "New goal": opens the new-goal flow. Other screens can drop this in wherever they offer to start one. */
export function NewGoalButton({
  variant = 'primary',
  size = 'md',
  showKey = false,
}: {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  /** Exposes the `n` shortcut to assistive tech (on the goals page, where it works). */
  showKey?: boolean
}) {
  return (
    <Button
      variant={variant}
      size={size}
      iconLeft={<Plus />}
      aria-keyshortcuts={showKey ? 'n' : undefined}
      onClick={openNewGoalFlow}
    >
      New goal
    </Button>
  )
}
