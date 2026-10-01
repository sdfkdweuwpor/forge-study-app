import { dayX, type Scale } from '@/logic/roadmap'
import styles from './MonthRow.module.css'

/** The month names and "Today" over the lanes' track column (or over the track alone, `inline`). */
export function MonthRow({
  scale,
  today,
  inline = false,
}: {
  scale: Scale
  today: string
  inline?: boolean
}) {
  const todayX = dayX(scale, today) + 0.5 / scale.days
  return (
    <div className={styles.monthRow} data-inline={inline || undefined} aria-hidden="true">
      <div className={styles.months}>
        {scale.months.map((m) => (
          <span key={m.key} className={styles.month} style={{ left: `${m.x * 100}%` }}>
            {m.label}
          </span>
        ))}
        <span className={styles.todayLabel} style={{ left: `${todayX * 100}%` }}>
          Today
        </span>
      </div>
    </div>
  )
}
