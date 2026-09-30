import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import styles from './sections.module.css'

/** A section while its data loads: a heading line and a block the height of the chart. */
export function ChartSkeleton({ what, height = 160 }: { what: string; height?: number }) {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true" aria-label={`Loading ${what}`}>
      <Skeleton width={132} />
      <Skeleton variant="block" height={height} />
    </div>
  )
}

/** Reading a section failed. The data is untouched, so the only step is to try again. */
export function SectionError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <EmptyState
      size="sm"
      align="start"
      titleAs="h2"
      icon={<CircleAlert />}
      title={`Couldn’t load ${what}`}
      description="Your data is safe on this device. Try again, or reload the page."
      action={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  )
}

/** One section's own error boundary, so a failed read leaves the rest of the page in place. */
export function SectionBoundary({ what, children }: { what: string; children: ReactNode }) {
  return (
    <ErrorBoundary fallback={(_error, reset) => <SectionError what={what} onRetry={reset} />}>
      {children}
    </ErrorBoundary>
  )
}
