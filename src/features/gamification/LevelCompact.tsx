/**
 * The level where the sidebar meter has no room (the open item of 6D, closed in Phase 13):
 *
 * - `LevelBadge` (`sidebar.rail`): a small gold ring with the level inside it, beside the "Open sidebar"
 *   button while the sidebar is collapsed (desktop) or a drawer (tablet). Hover or focus says what the
 *   meter says; clicking opens the rewards page.
 * - `LevelRow` (`more.footer`): "Level 7" and its XP on one row at the foot of the phone's More sheet,
 *   the way the meter sits at the foot of the sidebar.
 *
 * Both read `useXp()`, the hook the meter reads, so the three can never disagree. Each has its own
 * loading skeleton and its own "Try again" if the read fails.
 */
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { Link } from '@/app/router'
import { useXp, type XpSummary } from '@/db/hooks/useXp'
import { ProgressRing } from '@/ui/ProgressRing'
import { Skeleton } from '@/ui/Skeleton'
import { Tooltip } from '@/ui/Tooltip'
import { LevelTip, formatCount } from './LevelMeter'
import styles from './LevelCompact.module.css'

const BADGE_RING = 28
const ROW_RING = 28
const RING_STROKE = 3

const summaryOf = (xp: XpSummary): { level: number; progress: string; label: string } => {
  const { level, intoLevel, needed } = xp.level
  const progress = `${formatCount(intoLevel)} / ${formatCount(needed)} XP`
  return { level, progress, label: `Level ${level}, ${progress}. Open rewards` }
}

/** The ring: gold progress to the next level, the level number inside. Decorative, the link names it. */
function LevelRing({ xp, size, className }: { xp: XpSummary; size: number; className?: string }) {
  const { level, intoLevel, needed } = xp.level
  return (
    <ProgressRing
      tone="xp"
      size={size}
      stroke={RING_STROKE}
      value={intoLevel}
      max={needed}
      label="Progress to the next level"
      aria-hidden="true"
      className={className}
    >
      <span className={styles.digits} data-long={level >= 100 || undefined}>
        {level}
      </span>
    </ProgressRing>
  )
}

function BadgeView() {
  const xp = useXp()
  if (xp === undefined) {
    return (
      <span
        className={styles.badge}
        data-loading=""
        aria-busy="true"
        data-testid="level-badge-loading"
      >
        <Skeleton variant="circle" width={BADGE_RING} height={BADGE_RING} />
      </span>
    )
  }
  const { label } = summaryOf(xp)
  return (
    <Tooltip side="bottom" describe={false} content={<LevelTip xp={xp} />}>
      <Link to="rewards" className={styles.badge} data-testid="level-badge" aria-label={label}>
        <LevelRing xp={xp} size={BADGE_RING} />
      </Link>
    </Tooltip>
  )
}

function RowView() {
  const xp = useXp()
  if (xp === undefined) {
    return (
      <div className={styles.row} data-loading="" aria-busy="true" data-testid="level-row-loading">
        <Skeleton variant="circle" width={ROW_RING} height={ROW_RING} />
        <Skeleton width={72} />
      </div>
    )
  }
  const { level, progress, label } = summaryOf(xp)
  return (
    <Link to="rewards" className={styles.row} data-testid="level-row" aria-label={label}>
      <LevelRing xp={xp} size={ROW_RING} className={styles.rowRing} />
      <span className={styles.level}>Level {level}</span>
      <span className={styles.numbers}>{progress}</span>
    </Link>
  )
}

/** Slot `sidebar.rail`. */
export function LevelBadge() {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <button
          type="button"
          className={styles.badge}
          onClick={reset}
          aria-label="Level unavailable. Try again"
        >
          <span className={styles.digits} aria-hidden="true">
            ?
          </span>
        </button>
      )}
    >
      <BadgeView />
    </ErrorBoundary>
  )
}

/** Slot `more.footer`. */
export function LevelRow() {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <button type="button" className={styles.row} onClick={reset}>
          Level unavailable. Try again
        </button>
      )}
    >
      <RowView />
    </ErrorBoundary>
  )
}
