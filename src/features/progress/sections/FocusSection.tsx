import { useMemo } from 'react'
import { Link } from '@/app/router'
import type { ISODate } from '@/db/types'
import { addDays } from '@/logic/dates'
import { focusMinutesByDay } from '@/logic/stats'
import { dayBars, durationText, minutesTick } from '@/logic/statsLabels'
import { BarChart, niceTimeTicks } from '@/ui/charts'
import { useFocusSessions } from '../queries'
import { ChartSkeleton, SectionBoundary } from './SectionStates'
import { useProgressEnv } from './useProgressEnv'
import styles from './sections.module.css'

const DAYS = 30

function FocusBody({ today }: { today: ISODate }) {
  const sessions = useFocusSessions(addDays(today, -(DAYS - 1)), today)
  const days = useMemo(
    () => (sessions ? focusMinutesByDay(sessions, today, DAYS) : undefined),
    [sessions, today],
  )
  if (!days) return <ChartSkeleton what="focus minutes" />

  const total = days.reduce((sum, d) => sum + d.minutes, 0)
  const active = days.filter((d) => d.minutes > 0).length
  return (
    <BarChart
      data={dayBars(days)}
      title="Focus minutes"
      titleAs="h2"
      subtitle={
        total > 0
          ? `Last 30 days · ${durationText(total)} on ${active} ${active === 1 ? 'day' : 'days'}`
          : 'Last 30 days'
      }
      highlightKey={today}
      format={durationText}
      tickFormat={minutesTick}
      ticks={niceTimeTicks}
      labelHeader="Day"
      valueHeader="Focus time"
      emptyText="Focus time for the last 30 days will show up here."
      empty={
        <p className={styles.note}>
          No focus time in the last 30 days.{' '}
          <Link to="focus" className={styles.link}>
            Start a session
          </Link>{' '}
          when you’re ready.
        </p>
      }
    />
  )
}

/** Focus minutes per day for the last 30 days. */
export function FocusSection() {
  const env = useProgressEnv()
  return (
    <section className={styles.section} aria-label="Focus minutes" data-section="focus-days">
      <SectionBoundary what="focus minutes">
        {env ? <FocusBody today={env.today} /> : <ChartSkeleton what="focus minutes" />}
      </SectionBoundary>
    </section>
  )
}
