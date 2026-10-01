import { useMemo } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useToday } from '@/app/hooks/useToday'
import { Link } from '@/app/router'
import { useBadges } from '@/db/hooks/useBadges'
import { formatUnlockDate, recentBadges } from '@/logic/badges'
import { dayStartMs } from '@/logic/dates'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'
import styles from './BadgeRecent.module.css'

export interface RecentBadgesProps {
  /** How many of the newest unlocks to show. Default 3. */
  limit?: number
}

function RecentBadgesBody({ limit }: Required<RecentBadgesProps>) {
  const rows = useBadges()
  const today = useToday()
  const recent = useMemo(
    () => (rows === undefined ? null : recentBadges(rows, limit)),
    [rows, limit],
  )

  if (recent === null) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading badges">
        <Skeleton lines={limit} />
      </div>
    )
  }
  if (recent.length === 0) {
    return (
      <p className={styles.empty}>
        No badges yet. Finish a focus session to earn your first one.{' '}
        <Link to="rewards" params={{ tab: 'badges' }} className={styles.link}>
          See all badges
        </Link>
      </p>
    )
  }
  const nowMs = dayStartMs(today)
  return (
    <div className={styles.root}>
      <ul className={styles.list}>
        {recent.map((b) => (
          <li key={b.id} className={styles.row}>
            <span className={styles.icon} aria-hidden="true">
              {b.icon}
            </span>
            <span className={styles.title}>{b.title}</span>
            {b.unlockedAt !== null && (
              <span className={styles.date}>{formatUnlockDate(b.unlockedAt, nowMs)}</span>
            )}
          </li>
        ))}
      </ul>
      <Link to="rewards" params={{ tab: 'badges' }} className={styles.link}>
        See all badges
      </Link>
    </div>
  )
}

/**
 * The newest unlocked badges as a short list, for the Progress page. Loads, shows what to do when there
 * are none yet, and links to the full grid.
 */
export function RecentBadges({ limit = 3 }: RecentBadgesProps) {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <p className={styles.empty}>
          Couldn’t load your badges.{' '}
          <Button variant="ghost" size="sm" onClick={reset}>
            Try again
          </Button>
        </p>
      )}
    >
      <RecentBadgesBody limit={limit} />
    </ErrorBoundary>
  )
}
