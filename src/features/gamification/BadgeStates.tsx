import { CircleAlert } from 'lucide-react'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import styles from './BadgesGrid.module.css'

/** The grid while badges load: the footprint of six cards. */
export function BadgesSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading badges" className={styles.root}>
      <div className={styles.head}>
        <Skeleton width={140} />
        <Skeleton variant="block" width={240} height={6} />
      </div>
      <div className={styles.grid}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={styles.skeletonCard}>
            <Skeleton variant="block" width={44} height={44} />
            <Skeleton width="55%" />
            <Skeleton lines={2} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Reading badges failed. Nothing is lost; the only step is to try again. */
export function BadgesError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={<CircleAlert />}
      title="Couldn’t load your badges"
      description="Your data is safe on this device. Try again, or reload the page."
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  )
}
