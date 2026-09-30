import { CircleAlert, Route } from 'lucide-react'
import { openNewGoalFlow } from '@/features/goals'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import styles from './states.module.css'

/** No active goals: the roadmap has nothing to draw, and the one step is to plan a goal. */
export function RoadmapEmpty() {
  return (
    <EmptyState
      icon={<Route />}
      title="Nothing on the roadmap yet"
      description="Plan a goal and each course, exam and milestone lands here on a timeline, with the date you are on course to finish."
      action={
        <Button variant="primary" onClick={() => openNewGoalFlow()}>
          Plan a goal
        </Button>
      }
    />
  )
}

/** The chart while goals load: a month header and three lanes. */
export function RoadmapSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true" aria-label="Loading roadmap">
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.lane}>
          <div className={styles.label}>
            <Skeleton width={i === 1 ? '50%' : '70%'} />
            <Skeleton variant="block" height={6} />
          </div>
          <Skeleton variant="block" height={44} />
        </div>
      ))}
    </div>
  )
}

/** Reading goals failed. The data is untouched, so the only step is to try again. */
export function RoadmapError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={<CircleAlert />}
      title="Couldn’t load the roadmap"
      description="Your data is safe on this device. Try again, or reload the page."
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  )
}
