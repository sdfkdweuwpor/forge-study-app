import type { Milestone } from '@/db/types'
import { courseLabel } from '@/logic/goalDisplay'
import styles from './GoalTimeline.module.css'

/**
 * Placeholder for the Gantt timeline (Phase 5D replaces this component, keeping the props). Until then
 * it shows the course sequence as one strip, each course as wide as its hours, coloured by status.
 */
export function GoalTimeline({
  courses,
  hours,
}: {
  /** In course order. */
  courses: readonly Pick<Milestone, 'id' | 'code' | 'title' | 'status'>[]
  /** Total minutes per course id, so segments are as wide as the work. */
  hours: ReadonlyMap<string, number>
}) {
  if (courses.length === 0) return null
  return (
    <section className={styles.root} aria-label="Timeline">
      <ol className={styles.strip}>
        {courses.map((c) => (
          <li
            key={c.id}
            className={styles.segment}
            data-status={c.status}
            style={{ flexGrow: Math.max(hours.get(c.id) ?? 0, 60) }}
            title={courseLabel(c)}
          >
            <span className={styles.label}>{c.code ?? c.title}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
