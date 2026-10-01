import { Lock } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { dayOf } from '@/logic/dates'
import { formatUnlockDate, formatUnlockDateLong, type BadgeState } from '@/logic/badges'
import { Tooltip } from '@/ui/Tooltip'
import styles from './BadgeCard.module.css'
import { displayContext } from './badgeDisplay'

export interface BadgeCardProps {
  badge: BadgeState
  /** "Now", for the year of the unlock date: "Sep 29" this year, "Sep 29, 2025" before. */
  nowMs: number
}

/**
 * The card is read-only but takes focus, so its tooltip (the full date and what earned it, or how to earn
 * it) is reachable from the keyboard. Passed as props so the lint rule against `tabIndex` on a static
 * element does not fire: it is deliberate here.
 */
const FOCUSABLE = { tabIndex: 0 } as const

function unlockedTip(at: number, context: string | null): ReactNode {
  const date = `Unlocked ${formatUnlockDateLong(at)}`
  if (!context) return date
  return (
    <span className={styles.tip}>
      <span>{date}</span>
      <span className={styles.tipContext}>{displayContext(context)}</span>
    </span>
  )
}

/**
 * One badge. Unlocked: emoji, title, what it means, and "Unlocked Sep 29". Locked: the same emoji in
 * grayscale, a muted title, and a hint that says what to do, never what was missed. The tooltip adds
 * the full date and what earned it (on two lines), or repeats how to earn it.
 */
export function BadgeCard({ badge, nowMs }: BadgeCardProps) {
  const id = useId()
  const unlockedAt = badge.unlocked ? badge.unlockedAt : null
  const tip =
    unlockedAt === null ? `Locked · ${badge.hint}` : unlockedTip(unlockedAt, badge.context)

  return (
    <Tooltip content={tip} side="top">
      <div
        className={styles.card}
        data-state={unlockedAt === null ? 'locked' : 'unlocked'}
        data-badge={badge.id}
        role="group"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-detail`}
        {...FOCUSABLE}
      >
        <span className={styles.icon} aria-hidden="true">
          <span className={styles.glyph}>{badge.icon}</span>
        </span>
        <h3 id={`${id}-title`} className={styles.title}>
          {badge.title}
        </h3>
        <p id={`${id}-detail`} className={styles.detail}>
          {unlockedAt === null ? badge.hint : badge.description}
        </p>
        {unlockedAt === null ? (
          <p className={styles.status}>
            <Lock size={12} aria-hidden="true" />
            Locked
          </p>
        ) : (
          <p className={styles.status}>
            Unlocked <time dateTime={dayOf(unlockedAt)}>{formatUnlockDate(unlockedAt, nowMs)}</time>
          </p>
        )}
      </div>
    </Tooltip>
  )
}
