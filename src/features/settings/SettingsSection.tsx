import { useId, type ReactNode } from 'react'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'
import styles from './settings.module.css'

interface SectionProps {
  title: string
  /** One quiet line under the heading. */
  intro?: string
  children: ReactNode
}

/** A built-in section: hairline heading, then its rows. The page wraps it in the anchor that deep links scroll to. */
export function SettingsSection({ title, intro, children }: SectionProps) {
  const headingId = useId()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {title}
      </h2>
      {intro ? <p className={styles.intro}>{intro}</p> : null}
      {children}
    </section>
  )
}

/** The loading state of a section: the heading is real, the rows are placeholders. */
export function SectionLoading({ title, rows = 3 }: { title: string; rows?: number }) {
  return (
    <SettingsSection title={title}>
      <div
        className={styles.loading}
        role="status"
        aria-label={`Loading ${title.toLowerCase()} settings`}
      >
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} variant="block" height={44} />
        ))}
      </div>
    </SettingsSection>
  )
}

/** The error state of a section: it failed to draw, the rest of the page is fine. */
export function SectionFailed({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <SettingsSection title={title}>
      <div className={styles.failed} role="alert">
        <span>Couldn’t load these settings.</span>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </SettingsSection>
  )
}
