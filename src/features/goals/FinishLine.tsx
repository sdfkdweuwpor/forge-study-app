import { CalendarCheck, TriangleAlert } from 'lucide-react'
import type { FinishSummary } from '@/logic/goalDisplay'
import styles from './FinishLine.module.css'

/**
 * The projected finish in words ("Now projected: Mar 14 (+9 days)"), coloured by how far behind it is:
 * amber for a small slip, red for a large one or a plan that cannot finish. The target date and any
 * explanation sit under it in a quieter colour. 5D adds the one-click catch-up beside it.
 */
export function FinishLine({
  summary,
  size = 'md',
}: {
  summary: FinishSummary
  size?: 'sm' | 'md'
}) {
  const Icon = summary.tone === 'warning' || summary.tone === 'danger' ? TriangleAlert : CalendarCheck
  return (
    <div className={styles.root} data-tone={summary.tone} data-size={size}>
      <p className={styles.headline}>
        <Icon className={styles.icon} size={size === 'sm' ? 14 : 16} aria-hidden="true" />
        <span>{summary.headline}</span>
      </p>
      {summary.target !== null || summary.note !== null ? (
        <p className={styles.detail}>
          {[summary.target, summary.note].filter((s) => s !== null).join(' · ')}
        </p>
      ) : null}
    </div>
  )
}
