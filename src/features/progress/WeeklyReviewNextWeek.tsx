import { format } from 'date-fns'
import { useId } from 'react'
import { Link } from '@/app/router'
import { fromISODate } from '@/logic/dates'
import { windowLabel } from '@/logic/calendarWeek'
import { durationText } from '@/logic/statsLabels'
import type { NextWeekDay } from '@/logic/weeklyReview'
import styles from './WeeklyReviewPage.module.css'

/** "Mon" and "28": a day column's two lines. */
const weekdayShort = (day: string): string => format(fromISODate(day), 'EEE')
const dayNumber = (day: string): string => format(fromISODate(day), 'd')

const itemsText = (items: number): string => (items === 1 ? '1 item' : `${items} items`)

/** The day's main line: its planned time, "Flexible" for items with no length, "Free" for a clear day. */
const minutesLine = (d: NextWeekDay): string =>
  d.minutes > 0 ? durationText(d.minutes) : d.items > 0 ? 'Flexible' : 'Free'

/**
 * Next week at a glance: seven day columns with the minutes and the number of items planned on each
 * (open tasks with a do date, or a deadline and no do date), and a link to the Week view to change any
 * of it. A day with nothing planned reads "Free", never "empty" or "missed". A list on a phone.
 */
export function WeeklyReviewNextWeek({ days }: { days: readonly NextWeekDay[] }) {
  const headingId = useId()
  const first = days[0]
  const last = days[days.length - 1]
  const busiest = Math.max(0, ...days.map((d) => d.minutes))
  const totalItems = days.reduce((sum, d) => sum + d.items, 0)
  const totalMinutes = days.reduce((sum, d) => sum + d.minutes, 0)

  return (
    <section className={styles.section} aria-labelledby={headingId} data-section="next-week">
      <div className={styles.headingRow}>
        <div className={styles.headingGroup}>
          <h2 className={styles.heading} id={headingId}>
            Next week
          </h2>
          <p className={styles.sub}>
            {windowLabel(days.map((d) => d.day))}
            {totalItems > 0
              ? ` · ${totalItems} ${totalItems === 1 ? 'item' : 'items'}${totalMinutes > 0 ? `, ${durationText(totalMinutes)}` : ''}`
              : ''}
          </p>
        </div>
        {first ? (
          <Link
            to="tasks"
            params={{ list: 'all' }}
            query={{ layout: 'calendar', date: first.day }}
            className={styles.link}
            data-testid="review-week-view-link"
          >
            Open in Week view
          </Link>
        ) : null}
      </div>
      {totalItems === 0 && last ? (
        <p className={styles.note}>
          Nothing is planned yet. Add tasks to a day in the Week view and they show up here.
        </p>
      ) : null}
      <ol className={styles.days} aria-label="Planned time and items for each day of next week">
        {days.map((d) => (
          <li
            key={d.day}
            className={styles.day}
            data-empty={d.items === 0 || undefined}
            data-untimed={d.minutes === 0 || undefined}
            data-testid={`review-next-${d.day}`}
          >
            <span className={styles.dayName}>
              {weekdayShort(d.day)} <span className={styles.dayNum}>{dayNumber(d.day)}</span>
            </span>
            <span className={styles.dayMinutes}>{minutesLine(d)}</span>
            <span className={styles.dayItems}>{d.items > 0 ? itemsText(d.items) : ''}</span>
            <span className={styles.dayBar} aria-hidden="true">
              <span
                className={styles.dayFill}
                style={{ width: busiest > 0 ? `${Math.round((d.minutes / busiest) * 100)}%` : '0%' }}
              />
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
