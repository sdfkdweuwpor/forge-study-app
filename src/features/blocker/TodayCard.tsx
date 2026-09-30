import { useToday } from '@/app/hooks/useToday'
import { Link } from '@/app/router'
import { attemptsOn, todayHeadline } from '@/logic/blockerStats'
import { Skeleton } from '@/ui/Skeleton'
import { useBlockEvents } from './queries'
import { useBlockerActive } from './useBlockerActive'
import styles from './TodayCard.module.css'

/**
 * `today.aside`: "Distractions blocked today: 7", framed as wins. Only shown once the extension is
 * connected or has reported something, so it never advertises a feature that is not set up.
 */
export function TodayCard() {
  const active = useBlockerActive()
  const today = useToday()
  const events = useBlockEvents(today)
  if (!active) return null

  const summary = events ? attemptsOn(events, today) : null
  return (
    <section className={styles.card} aria-labelledby="blocker-today-card">
      <h2 className={styles.heading} id="blocker-today-card">
        Distractions blocked today
      </h2>
      {summary === null ? (
        <div
          className={styles.skeleton}
          role="status"
          aria-busy="true"
          aria-label="Loading blocked attempts"
        >
          <Skeleton width={48} height={32} variant="block" />
          <Skeleton width="80%" />
        </div>
      ) : (
        <>
          <p className={styles.number}>{summary.total}</p>
          <p className={styles.line}>{todayHeadline(summary)}</p>
          <Link to="blocker" className={styles.link}>
            Open the blocker
          </Link>
        </>
      )}
    </section>
  )
}
