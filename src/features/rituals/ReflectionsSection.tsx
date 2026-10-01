import { format } from 'date-fns'
import { ChevronDown, ChevronRight, CircleAlert } from 'lucide-react'
import { useId, useState } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { fromISODate } from '@/logic/dates'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { useReflections } from './queries'
import styles from './Reflections.module.css'

/**
 * Slot `progress.sections`: "Reflections", the one line you left at the end of each day, newest first.
 * Collapsed until you open it. It never scores or compares: it is only your own words, kept on this device.
 */
export function ReflectionsSection() {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <section className={styles.section} aria-label="Reflections">
          <EmptyState
            size="sm"
            align="start"
            titleAs="h2"
            icon={<CircleAlert />}
            title="Couldn’t load your reflections"
            description="They are safe on this device. Try again, or reload the page."
            action={
              <Button variant="secondary" size="sm" onClick={reset}>
                Try again
              </Button>
            }
          />
        </section>
      )}
    >
      <ReflectionsBody />
    </ErrorBoundary>
  )
}

function ReflectionsBody() {
  const rows = useReflections(30)
  const [open, setOpen] = useState(false)
  const headingId = useId()
  const panelId = useId()

  return (
    <section
      className={styles.section}
      aria-labelledby={headingId}
      data-testid="reflections"
      aria-busy={rows === undefined || undefined}
    >
      <h2 className={styles.heading} id={headingId}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          <span>Reflections{rows === undefined ? '' : ` (${rows.length})`}</span>
        </button>
      </h2>
      <div id={panelId} hidden={!open} className={styles.body}>
        {rows === undefined ? (
          <div className={styles.skeleton} role="status" aria-label="Loading reflections">
            <Skeleton width="70%" />
            <Skeleton width="50%" />
          </div>
        ) : rows.length === 0 ? (
          <p className={styles.quiet}>
            The line you leave at the end of the evening shutdown collects here. There is nothing to
            catch up on.
          </p>
        ) : (
          <ul className={styles.list} aria-label="Reflections, newest first">
            {rows.map((row) => (
              <li key={row.id} className={styles.item}>
                <time className={styles.day} dateTime={row.day}>
                  {format(fromISODate(row.day), 'EEE, MMM d')}
                </time>
                <p className={styles.text}>{row.reflection}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
