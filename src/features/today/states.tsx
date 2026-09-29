import { CircleAlert, Sun } from 'lucide-react'
import { useOverlays } from '@/app/providers/OverlayProvider'
import { navigate } from '@/app/router'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Kbd } from '@/ui/Kbd'
import { Skeleton } from '@/ui/Skeleton'
import { NowCardSkeleton } from './NowCard'
import styles from './states.module.css'

const ROW_WIDTHS = ['58%', '72%', '46%', '64%', '52%']

/** The page while tasks load: the Now card's footprint and a few rows. */
export function TodaySkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true">
      <NowCardSkeleton />
      <div role="status" aria-label="Loading today’s tasks" className={styles.rows}>
        <Skeleton width={96} />
        {ROW_WIDTHS.map((width, i) => (
          <div key={i} className={styles.row}>
            <Skeleton variant="circle" width={18} />
            <Skeleton width={width} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Reading today's tasks failed. The data is untouched, so the only step is to try again. */
export function TodayError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={<CircleAlert />}
      title="Couldn’t load today"
      description="Your data is safe on this device. Try again, or reload the page."
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  )
}

/** A brand-new user: no tasks and nothing to schedule yet. */
export function TodayEmpty({ hasGoals }: { hasGoals: boolean }) {
  const overlays = useOverlays()
  return (
    <EmptyState
      icon={<Sun />}
      title="A clear day to plan"
      description={
        hasGoals
          ? 'Nothing is scheduled yet. Add a task, or open a goal to plan its study days.'
          : 'Add a task, or set up a goal such as your B.S. in Computer Science and Forge will schedule C182, C779 and the rest of your courses into daily study blocks.'
      }
      action={
        <>
          <Button variant="primary" onClick={() => overlays.open('quickAdd')}>
            Add a task
          </Button>
          <Button variant="secondary" onClick={() => navigate(hasGoals ? 'goals' : 'goalNew')}>
            {hasGoals ? 'Open goals' : 'Create a goal'}
          </Button>
          <span className={styles.hint}>
            Press <Kbd keys="q" size="sm" /> anywhere to add a task
          </span>
        </>
      }
    />
  )
}
