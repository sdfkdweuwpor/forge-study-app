import { useMemo } from 'react'
import { Link, setQuery, useQuery } from '@/app/router'
import { useShortcutHandler } from '@/app/shortcuts'
import type { ISODate } from '@/db/types'
import { addDays } from '@/logic/dates'
import { minutesByCourse, minutesByGoal } from '@/logic/stats'
import { durationText } from '@/logic/statsLabels'
import { HBarList } from '@/ui/charts'
import { SegmentedControl, type SegmentOption } from '@/ui/SegmentedControl'
import { useFocusSessions, useTimeRefs } from '../queries'
import { ChartSkeleton, SectionBoundary } from './SectionStates'
import { useProgressEnv } from './useProgressEnv'
import styles from './sections.module.css'

const DAYS = 30

export type TimeGrouping = 'goal' | 'course'

const OPTIONS: readonly SegmentOption<TimeGrouping>[] = [
  { value: 'goal', label: 'Goals' },
  { value: 'course', label: 'Courses' },
]

/** `?by=course` selects courses; anything else is goals. The address is the state, so a reload keeps it. */
export function groupingFromQuery(by: string | undefined): TimeGrouping {
  return by === 'course' ? 'course' : 'goal'
}

export function setGrouping(by: TimeGrouping): void {
  setQuery({ by: by === 'goal' ? undefined : 'course' })
}

function TimeBody({ today }: { today: ISODate }) {
  const by = groupingFromQuery(useQuery().by)
  const sessions = useFocusSessions(addDays(today, -(DAYS - 1)), today)
  const refs = useTimeRefs()
  useShortcutHandler('progress.byGoal', () => setGrouping('goal'))
  useShortcutHandler('progress.byCourse', () => setGrouping('course'))

  const rows = useMemo(() => {
    if (!sessions || !refs) return undefined
    const range = { from: addDays(today, -(DAYS - 1)), to: today }
    return by === 'goal'
      ? minutesByGoal(sessions, refs.goals, range)
      : minutesByCourse(sessions, refs.courses, range)
  }, [sessions, refs, by, today])

  const toggle = (
    <SegmentedControl<TimeGrouping>
      label="Group time by"
      size="sm"
      options={OPTIONS}
      value={by}
      onValueChange={setGrouping}
    />
  )

  if (!rows) return <ChartSkeleton what="time per goal" />
  const total = rows.reduce((sum, r) => sum + r.minutes, 0)
  return (
    <HBarList
      title={by === 'goal' ? 'Time per goal' : 'Time per course'}
      titleAs="h2"
      subtitle={total > 0 ? `Last 30 days · ${durationText(total)}` : 'Last 30 days'}
      actions={toggle}
      items={rows.map((r) => ({
        id: r.id ?? 'other',
        label: r.title,
        value: r.minutes,
        color: r.color,
      }))}
      format={durationText}
      labelHeader={by === 'goal' ? 'Goal' : 'Course'}
      valueHeader="Focus time"
      empty={
        <p className={styles.note}>
          Time you focus is split by {by === 'goal' ? 'goal' : 'course'} here. Link a session to a
          task to fill it in, or{' '}
          <Link to="focus" className={styles.link}>
            start one now
          </Link>
          .
        </p>
      }
    />
  )
}

/** Focus time per goal, or per course, for the last 30 days. */
export function TimeSection() {
  const env = useProgressEnv()
  return (
    <section className={styles.section} aria-label="Time per goal or course" data-section="time">
      <SectionBoundary what="time per goal">
        {env ? <TimeBody today={env.today} /> : <ChartSkeleton what="time per goal" />}
      </SectionBoundary>
    </section>
  )
}
