/**
 * The "Time today" / "This week" card of the `today.aside` slot: focus minutes per goal as a small bar
 * each, with "Other" for sessions that have no goal. Bars are scaled to the largest row of their list.
 * A quiet day is a quiet card; there is no target and nothing to fall short of.
 */
import { useToday } from '@/app/hooks/useToday'
import type { ID } from '@/db/types'
import { formatLogged, type GoalTime } from '@/logic/timeLogged'
import { Skeleton } from '@/ui/Skeleton'
import { useTimeLogged, type GoalLabel } from './queries'
import styles from './TimeAside.module.css'

interface ListProps {
  heading: string
  id: string
  rows: readonly GoalTime[]
  goals: ReadonlyMap<ID, GoalLabel>
  empty: string
}

function TimeList({ heading, id, rows, goals, empty }: ListProps) {
  const max = Math.max(1, ...rows.map((r) => r.minutes))
  const total = rows.reduce((sum, r) => sum + r.minutes, 0)
  return (
    <section className={styles.block} aria-labelledby={id} data-testid={id}>
      <h2 className={styles.heading} id={id}>
        <span>{heading}</span>
        {total > 0 ? <span className={styles.total}>{formatLogged(total)}</span> : null}
      </h2>
      {rows.length === 0 ? (
        <p className={styles.quiet}>{empty}</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => {
            const goal = row.goalId === null ? undefined : goals.get(row.goalId)
            const name = goal?.title ?? 'Other'
            return (
              <li key={row.goalId ?? 'other'} className={styles.row}>
                <div className={styles.line}>
                  <span className={styles.name}>
                    {goal ? (
                      <span className={styles.icon} aria-hidden="true">
                        {goal.icon}
                      </span>
                    ) : null}
                    <span className={styles.title}>{name}</span>
                  </span>
                  <span className={styles.minutes}>{formatLogged(row.minutes)}</span>
                </div>
                {/* Decorative: the name and time are already read from the line above. */}
                <div
                  className={styles.bar}
                  aria-hidden="true"
                  data-other={row.goalId === null || undefined}
                >
                  <span
                    className={styles.fill}
                    style={{ width: `${(row.minutes / max) * 100}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function TimePerGoalCard() {
  const today = useToday()
  const logged = useTimeLogged(today)

  if (logged === undefined) {
    return (
      <div className={styles.card} aria-busy="true">
        <Skeleton width="40%" />
        <Skeleton width="90%" lines={2} />
      </div>
    )
  }
  return (
    <div className={styles.card}>
      <TimeList
        heading="Time today"
        id="time-today"
        rows={logged.today}
        goals={logged.goals}
        empty="No focus time yet. Start a timer on any task and it lands here."
      />
      <TimeList
        heading="This week"
        id="time-week"
        rows={logged.week}
        goals={logged.goals}
        empty="Nothing logged this week yet."
      />
    </div>
  )
}
