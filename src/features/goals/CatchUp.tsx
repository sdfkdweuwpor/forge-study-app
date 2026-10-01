import { formatDay } from '@/logic/goalDisplay'
import { formatDuration } from '@/logic/scheduler/feasibility'
import type { Goal, ISODate } from '@/db/types'
import { Button } from '@/ui/Button'
import styles from './CatchUp.module.css'

/**
 * The one-click catch-up under the projection (PLAN 5D): shown only while the goal is behind its target
 * and the plan knows how much more time a study day needs. Nothing changes until the button is pressed.
 */
export function CatchUp({
  goal,
  today,
  onCatchUp,
}: {
  goal: Pick<Goal, 'targetDate' | 'projection'>
  today: ISODate
  onCatchUp: (minutes: number) => void
}) {
  const minutes = goal.projection?.catchUpMinutes ?? null
  if (minutes === null || !(minutes > 0) || goal.targetDate === null) return null
  const extra = formatDuration(minutes)
  return (
    <div className={styles.root}>
      <p className={styles.text}>
        {extra} more each study day finishes by {formatDay(goal.targetDate, today)}.
      </p>
      <Button size="sm" variant="secondary" onClick={() => onCatchUp(minutes)}>
        Add {extra} a day
      </Button>
    </div>
  )
}
