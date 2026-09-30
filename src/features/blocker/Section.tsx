import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import styles from './Section.module.css'

interface SectionProps {
  /** Unique on the page; names the heading for assistive tech. */
  id: string
  title: string
  description?: ReactNode
  /** Sits on the right of the heading (a count, a button). */
  actions?: ReactNode
  children: ReactNode
}

/**
 * One block of the Blocker page: a small heading, an optional line of help, then the content on the
 * page (hierarchy from type and spacing, no boxes). A failure while reading its data shows a quiet
 * error with "Try again" and leaves the rest of the page alone.
 */
export function Section({ id, title, description, actions, children }: SectionProps) {
  const headingId = `blocker-${id}`
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h2 id={headingId} className={styles.title}>
            {title}
          </h2>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      <ErrorBoundary
        fallback={(_e, reset) => <SectionError what={title.toLowerCase()} onRetry={reset} />}
      >
        {children}
      </ErrorBoundary>
    </section>
  )
}

/** Reading a section's data failed. Nothing was changed, so the only step is to try again. */
export function SectionError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <EmptyState
      size="sm"
      align="start"
      titleAs="h3"
      icon={<CircleAlert />}
      title={`Couldn’t load ${what}`}
      description="Your settings are safe on this device. Try again, or reload the page."
      action={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  )
}
