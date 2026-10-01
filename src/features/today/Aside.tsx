/**
 * The built-in cards of the `today.aside` slot: the upcoming milestone countdown and the 14-day mini
 * heatmap. Each reads through a hook in `queries.ts` (targets from goals and courses; days from
 * sessions, or finished tasks until there are sessions), so Phase 5 and Phase 7 can re-point the data
 * without touching the markup.
 */
import { format } from 'date-fns'
import { Snowflake } from 'lucide-react'
import type { ReactNode } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { Link } from '@/app/router'
import { fromISODate } from '@/logic/dates'
import { tagColor } from '@/logic/tagColor'
import { countdownText, type Countdown, type Heatmap, type HeatmapDay } from '@/logic/todayStats'
import { useSettings } from '@/db/hooks/useSettings'
import type { Settings } from '@/db/types'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import { Tooltip } from '@/ui/Tooltip'
import { useHeatmap, useUpcomingTargets } from './queries'
import styles from './Aside.module.css'

// ─── Milestone countdown ────────────────────────────────────────────────────

function TargetLink({ target, children }: { target: Countdown; children: ReactNode }) {
  if (target.kind === 'goal') {
    return (
      <Link to="goal" params={{ goalId: target.goalId }} className={styles.link}>
        {children}
      </Link>
    )
  }
  return (
    <Link
      to="course"
      params={{ goalId: target.goalId, courseId: target.id }}
      className={styles.link}
    >
      {children}
    </Link>
  )
}

function shortDate(date: string): string {
  return format(fromISODate(date), 'MMM d')
}

/** "C779 target: 12 days", and the two after it. */
export function MilestoneCountdown() {
  const today = useToday()
  const settings = useSettings()
  const targets = useUpcomingTargets(today, 3)

  return (
    <section className={styles.card} aria-labelledby="today-targets">
      <h2 className={styles.heading} id="today-targets">
        Upcoming target
      </h2>
      {targets === undefined || settings === undefined ? (
        <div className={styles.skeleton} aria-hidden="true">
          <Skeleton width="45%" />
          <Skeleton width="60%" height={32} />
          <Skeleton width="80%" />
        </div>
      ) : targets[0] === undefined ? (
        <p className={styles.quiet}>
          No target dates yet. Give a course or goal a date and its countdown shows up here.
        </p>
      ) : (
        <>
          <TargetLead target={targets[0]} tagColors={settings.tagColors} />
          {targets.length > 1 ? (
            <ul className={styles.more}>
              {targets.slice(1).map((t) => (
                <li key={t.id} className={styles.moreRow}>
                  <TargetLink target={t}>
                    <span className={styles.moreName}>{t.code ?? t.title}</span>
                  </TargetLink>
                  <span className={styles.moreDays} data-overdue={t.days < 0 || undefined}>
                    {countdownText(t.days)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  )
}

function TargetLead({
  target,
  tagColors,
}: {
  target: Countdown
  tagColors: Settings['tagColors']
}) {
  const overdue = target.days < 0
  return (
    <div className={styles.lead}>
      <p className={styles.leadLabel}>
        {target.code ? (
          <Tag size="sm" color={tagColor(target.code, tagColors)}>
            {target.code}
          </Tag>
        ) : null}
        <span>{target.code ? 'target' : `${target.title} target`}</span>
        <span className="sr-only">:</span>
      </p>
      <p className={styles.leadDays} data-overdue={overdue || undefined}>
        {countdownText(target.days)}
      </p>
      <p className={styles.leadMeta}>
        <TargetLink target={target}>{target.code ? target.title : 'Open goal'}</TargetLink>
        <span aria-hidden="true"> · </span>
        <span>{shortDate(target.date)}</span>
      </p>
    </div>
  )
}

// ─── 14-day heatmap ─────────────────────────────────────────────────────────

function cellLabel(day: HeatmapDay, basis: Heatmap['basis']): string {
  const date = format(fromISODate(day.day), 'EEE, MMM d')
  const parts: string[] = []
  if (day.frozen) parts.push('streak freeze')
  if (day.minutes > 0) parts.push(`${day.minutes} min focused`)
  if (day.tasks > 0) parts.push(`${day.tasks} ${day.tasks === 1 ? 'task' : 'tasks'} done`)
  if (parts.length === 0) parts.push(basis === 'focus' ? 'no focus' : 'nothing done')
  else if (day.frozen && parts.length === 1)
    parts.push(basis === 'focus' ? 'no focus' : 'nothing done')
  return `${date}: ${parts.join(', ')}`
}

/** Last 14 days as two rows of seven: shade is focused minutes, or finished tasks until sessions exist. */
export function MiniHeatmap() {
  const today = useToday()
  const map = useHeatmap(today, 14)

  return (
    <section className={styles.card} aria-labelledby="today-heat">
      <h2 className={styles.heading} id="today-heat">
        Last 14 days
      </h2>
      {map === undefined ? (
        <div className={styles.grid} aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <Skeleton key={i} variant="block" className={styles.cellSkeleton} />
          ))}
        </div>
      ) : (
        <>
          <ul className={styles.grid} aria-label="Activity, oldest day first">
            {map.days.map((day) => {
              const label = cellLabel(day, map.basis)
              return (
                <li key={day.day} className={styles.cellItem}>
                  <Tooltip content={label} describe={false}>
                    <span
                      className={styles.cell}
                      data-level={day.level}
                      data-today={day.day === today || undefined}
                      data-frozen={day.frozen || undefined}
                      role="img"
                      aria-label={label}
                    >
                      {day.frozen ? <Snowflake className={styles.snow} aria-hidden="true" /> : null}
                    </span>
                  </Tooltip>
                </li>
              )
            })}
          </ul>
          <p className={styles.caption}>
            <span>{map.basis === 'focus' ? 'Focused minutes' : 'Tasks finished'}</span>
            <span className={styles.legend} aria-hidden="true">
              <span>Less</span>
              {([0, 1, 2, 3, 4] as const).map((level) => (
                <span key={level} className={styles.swatch} data-level={level} />
              ))}
              <span>More</span>
            </span>
          </p>
          {map.days.some((d) => d.frozen) ? (
            <p className={styles.note}>
              <Snowflake className={styles.noteSnow} aria-hidden="true" />
              Streak freeze
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
