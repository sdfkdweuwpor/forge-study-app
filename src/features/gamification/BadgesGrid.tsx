import { useId, useMemo } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useToday } from '@/app/hooks/useToday'
import { useBadges } from '@/db/hooks/useBadges'
import { badgeStates, unlockSummary } from '@/logic/badges'
import { dayStartMs } from '@/logic/dates'
import { ProgressBar } from '@/ui/ProgressBar'
import { BadgeCard } from './BadgeCard'
import { BadgesError, BadgesSkeleton } from './BadgeStates'
import styles from './BadgesGrid.module.css'

function BadgesGridBody() {
  const rows = useBadges()
  const today = useToday()
  const headingId = useId()
  const states = useMemo(() => (rows === undefined ? null : badgeStates(rows)), [rows])
  if (states === null) return <BadgesSkeleton />

  const unlocked = states.filter((s) => s.unlocked).length
  const summary = unlockSummary(states)
  const nowMs = dayStartMs(today)

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        Badges
      </h2>
      <div className={styles.head}>
        <p className={styles.count} data-testid="badges-count">
          {summary}
        </p>
        <ProgressBar
          tone="xp"
          size="sm"
          value={unlocked}
          max={states.length}
          label="Badges unlocked"
          valueText={summary}
          className={styles.bar}
        />
        {unlocked === 0 && (
          <p className={styles.hint}>Finish a focus session to earn your first badge.</p>
        )}
      </div>
      <ul className={styles.grid}>
        {states.map((badge) => (
          <li key={badge.id} className={styles.item}>
            <BadgeCard badge={badge} nowMs={nowMs} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Every badge, earned or not: a responsive grid with a "6 of 11 unlocked" count. Unlocked cards show
 * their emoji, what they mean and the unlock date; locked ones are grey and say what to do. It loads,
 * shows its own error state, and needs no props, so the Rewards page's Badges tab renders it as is.
 */
export function BadgesGrid() {
  return (
    <ErrorBoundary fallback={(_error, reset) => <BadgesError onRetry={reset} />}>
      <BadgesGridBody />
    </ErrorBoundary>
  )
}
