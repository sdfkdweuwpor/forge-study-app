import { CalendarCheck, CircleAlert } from 'lucide-react'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import styles from './WeeklyReviewPage.module.css'

/** While the week's numbers are read: the shape of the page, so nothing jumps when they arrive. */
export function WeeklyReviewSkeleton() {
  return (
    <div
      className={styles.loading}
      role="status"
      aria-busy="true"
      aria-label="Loading your weekly review"
    >
      <Skeleton width={120} />
      <Skeleton variant="block" height={96} />
      <Skeleton variant="block" height={64} />
      <Skeleton variant="block" height={140} />
      <Skeleton variant="block" height={120} />
    </div>
  )
}

/** Reading failed. The data is untouched, so the only step is to try again. */
export function WeeklyReviewError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      titleAs="h2"
      icon={<CircleAlert />}
      title="Couldn’t load your weekly review"
      description="Your data is safe on this device. Try again, or reload the page."
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  )
}

/** A week with nothing logged: said gently, with no verdict. */
export function WeeklyReviewQuiet({ isOver }: { isOver: boolean }) {
  return (
    <EmptyState
      titleAs="h2"
      size="sm"
      align="start"
      className={styles.quiet}
      icon={<CalendarCheck />}
      title={isOver ? 'A quiet week' : 'Nothing logged yet this week'}
      description={
        isOver
          ? 'No focus sessions or finished tasks were logged for these days. That happens. Your note and next week are below whenever you want them.'
          : 'Finish a focus session or check off a task and your wins show up here. Next week is below if you want to look ahead.'
      }
    />
  )
}
