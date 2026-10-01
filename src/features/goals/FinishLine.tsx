import { CalendarCheck, CalendarClock } from 'lucide-react'
import type { FinishSummary } from '@/logic/goalDisplay'
import styles from './FinishLine.module.css'

/**
 * The projected finish in words ("Projected Mar 14 · 9 days after target"). Calm colours only: neutral,
 * amber for a larger slip, green when on track. The target date and any helpful note sit under it in a
 * quieter colour. 5D adds the one-click catch-up beside it.
 */
export function FinishLine({
  summary,
  size = 'md',
  detail = true,
}: {
  summary: FinishSummary
  size?: 'sm' | 'md'
  /** Show the target date and note under the headline. */
  detail?: boolean
}) {
  const Icon = summary.tone === 'warning' ? CalendarClock : CalendarCheck
  return (
    <div className={styles.root} data-tone={summary.tone} data-size={size}>
      <p className={styles.headline}>
        <Icon className={styles.icon} size={size === 'sm' ? 14 : 16} aria-hidden="true" />
        <span>{summary.headline}</span>
      </p>
      {detail && (summary.target !== null || summary.note !== null) ? (
        <p className={styles.detail}>
          {[summary.target, summary.note].filter((s) => s !== null).join(' · ')}
        </p>
      ) : null}
    </div>
  )
}
