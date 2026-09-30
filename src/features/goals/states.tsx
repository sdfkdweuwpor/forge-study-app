import { CircleAlert, Plus, Target } from 'lucide-react'
import { Link, navigate } from '@/app/router'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Kbd } from '@/ui/Kbd'
import { Skeleton } from '@/ui/Skeleton'
import { ImportGoalButton } from './import'
import styles from './states.module.css'

/** No goals yet: the one action is the wizard, and it can start from a WGU template. */
export function GoalsEmpty() {
  return (
    <EmptyState
      icon={<Target />}
      title="No goals yet"
      description="Turn a degree into daily study blocks. Add your courses and the hours you can study, and Forge schedules every day and moves the plan when you fall behind. Starting a WGU degree? Start from the B.S. Computer Science template, with C182, C779, D278 and more already filled in."
      action={
        <>
          <Button variant="primary" iconLeft={<Plus />} onClick={() => navigate('goalNew')}>
            Create a goal
          </Button>
          <ImportGoalButton />
          <span className={styles.hint}>
            or press <Kbd keys="n" size="sm" />
          </span>
        </>
      }
    />
  )
}

/** The goals list while it loads: three rows with the footprint of a goal. */
export function GoalsSkeleton() {
  return (
    <div className={styles.list} role="status" aria-busy="true" aria-label="Loading goals">
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.goalRow}>
          <Skeleton variant="block" width={40} height={40} />
          <div className={styles.goalBody}>
            <Skeleton width={i === 1 ? '42%' : '56%'} />
            <Skeleton variant="block" height={6} />
            <Skeleton width="34%" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Reading goals failed. The data is untouched, so the only step is to try again. */
export function GoalsError({ onRetry, what = 'goals' }: { onRetry: () => void; what?: string }) {
  return (
    <EmptyState
      icon={<CircleAlert />}
      title={`Couldn’t load your ${what}`}
      description="Your data is safe on this device. Try again, or reload the page."
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  )
}

/** A goal or course page while its rows load. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.page} role="status" aria-busy="true" aria-label={label}>
      <Skeleton width={220} />
      <Skeleton variant="block" width="52%" height={44} />
      <Skeleton variant="block" height={8} />
      <Skeleton lines={3} />
      <div className={styles.skeletonRows}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} variant="block" height={36} />
        ))}
      </div>
    </div>
  )
}

/** A link to a goal or course that no longer exists (deleted, in the trash, or mistyped). */
export function NotFoundState({ what }: { what: 'goal' | 'course' }) {
  return (
    <div className={styles.page}>
      <h1 className={styles.missingTitle}>
        {what === 'goal' ? 'Goal not found' : 'Course not found'}
      </h1>
      <EmptyState
        align="start"
        icon={<CircleAlert />}
        titleAs="p"
        title={`This ${what} isn’t here`}
        description="It may have been moved to the trash or deleted. Trashed items stay there for 30 days."
        action={
          <Link to="goals" className={styles.back}>
            Back to goals
          </Link>
        }
      />
    </div>
  )
}
