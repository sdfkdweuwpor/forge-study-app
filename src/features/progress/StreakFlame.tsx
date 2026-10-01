/**
 * The streak flame in the sidebar footer (`sidebar.footer`, BRIEF §5.7): one quiet line under the level
 * meter, "🔥 12 days". Hovering or focusing it says what the number is not: the best streak and
 * whether this week's automatic freeze is still there ("Best: 30 days · Freeze ready ❄️", or "Your
 * best yet" while the current run is the longest). With no streak
 * running it is a neutral, unlit flame and the tooltip only invites: "Start a streak today". There is no
 * red, no countdown and no "lost" anywhere. Clicking opens Progress and, in the tablet drawer, closes it
 * (`onNavigate`, like the level meter: a link to the page you are on changes no path, so the drawer
 * would never close by itself). Like the level meter it shows in the desktop sidebar and the tablet
 * drawer; a phone has no sidebar footer.
 */
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useToday } from '@/app/hooks/useToday'
import type { SlotProps } from '@/app/registry'
import { Link } from '@/app/router'
import { useStreak, type StreakState } from '@/db/hooks/useStreak'
import { Skeleton } from '@/ui/Skeleton'
import { Tooltip } from '@/ui/Tooltip'
import styles from './StreakFlame.module.css'

/** The tooltip's words. Neutral by design: never "lost", "broken" or "missed". */
export function streakTooltip(
  streak: Pick<StreakState, 'current' | 'best' | 'freezeAvailable'>,
): string {
  if (streak.current === 0) return 'Start a streak today'
  const best =
    streak.current >= streak.best
      ? 'Your best yet'
      : `Best: ${streak.best} ${streak.best === 1 ? 'day' : 'days'}`
  return `${best} · ${streak.freezeAvailable ? 'Freeze ready ❄️' : 'Freeze used this week'}`
}

function FlameSkeleton() {
  return (
    <div className={styles.flame} aria-busy="true" data-testid="streak-flame-loading">
      <Skeleton width={96} />
    </div>
  )
}

function Flame({ onNavigate }: SlotProps['sidebar.footer']) {
  const today = useToday()
  const streak = useStreak(today)
  if (streak === undefined) return <FlameSkeleton />

  const lit = streak.current > 0
  const tip = streakTooltip(streak)
  const label = lit
    ? `${streak.current}-day streak. ${tip.replace('❄️', '').trim()}. Open progress`
    : 'No streak yet. Start a streak today. Open progress'
  return (
    <Tooltip side="right" describe={false} content={tip}>
      <Link
        to="progress"
        className={styles.flame}
        data-testid="streak-flame"
        data-lit={lit || undefined}
        aria-label={label}
        onClick={onNavigate}
      >
        <span className={styles.glyph} aria-hidden="true">
          🔥
        </span>
        <span className={styles.count} data-testid="streak-count">
          {streak.current}
        </span>
        <span className={styles.caption}>{streak.current === 1 ? 'day' : 'days'}</span>
      </Link>
    </Tooltip>
  )
}

/** Slot `sidebar.footer`. `onNavigate` closes the tablet drawer, also when it is already on Progress. */
export function StreakFlame({ onNavigate }: SlotProps['sidebar.footer']) {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <button type="button" className={styles.error} onClick={reset}>
          Streak unavailable. Try again
        </button>
      )}
    >
      <Flame onNavigate={onNavigate} />
    </ErrorBoundary>
  )
}
