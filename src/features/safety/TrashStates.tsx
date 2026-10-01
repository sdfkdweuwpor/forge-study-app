import { CircleAlert, SearchX, Trash2 } from 'lucide-react'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import styles from './TrashPage.module.css'

/** The list while the Trash loads: three rows of the shape that is coming. */
export function TrashSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true" aria-label="Loading the Trash">
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.skeletonRow}>
          <div className={styles.skeletonText}>
            <Skeleton width={i === 1 ? '38%' : '52%'} />
            <Skeleton width={i === 1 ? '22%' : '30%'} />
          </div>
          <Skeleton variant="block" width={84} height={28} />
        </div>
      ))}
    </div>
  )
}

/** Nothing has been deleted (or it has all been restored or emptied). */
export function TrashEmpty() {
  return (
    <EmptyState
      titleAs="h2"
      icon={<Trash2 />}
      title="Nothing in the trash"
      description="Deleted items stay here for 30 days."
    />
  )
}

/** The search found nothing. */
export function TrashNoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <EmptyState
      titleAs="h2"
      icon={<SearchX />}
      title={`No deleted items match “${query.trim()}”`}
      description="Check the spelling, or search for a course code like C182."
      action={<Button onClick={onClear}>Clear search</Button>}
    />
  )
}

/** Reading the Trash failed. Nothing is lost by it, so the only step is to try again. */
export function TrashError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      titleAs="h2"
      icon={<CircleAlert />}
      title="Couldn’t load the Trash"
      description="Your deleted items are still on this device. Try again, or reload the page."
      action={<Button onClick={onRetry}>Try again</Button>}
    />
  )
}
