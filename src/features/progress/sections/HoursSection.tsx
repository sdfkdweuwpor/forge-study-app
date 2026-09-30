import { useMemo } from 'react'
import type { ISODate } from '@/db/types'
import { addDays } from '@/logic/dates'
import { hourHistogram, peakHour } from '@/logic/stats'
import { durationText, minutesTick } from '@/logic/statsLabels'
import { HourHistogram, niceTimeTicks } from '@/ui/charts'
import { useFocusSessions } from '../queries'
import { ChartSkeleton, SectionBoundary } from './SectionStates'
import { useProgressEnv } from './useProgressEnv'
import styles from './sections.module.css'

const DAYS = 90

/** "9 AM" for hour 9, "12 PM" for 12: the start of the busiest hour, in words. */
function hourWord(hour: number): string {
  const h = hour % 12 || 12
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`
}

function HoursBody({ today }: { today: ISODate }) {
  const sessions = useFocusSessions(addDays(today, -(DAYS - 1)), today)
  const minutes = useMemo(
    () =>
      sessions
        ? hourHistogram(sessions, { from: addDays(today, -(DAYS - 1)), to: today })
        : undefined,
    [sessions, today],
  )
  if (!minutes) return <ChartSkeleton what="best time of day" />

  const peak = peakHour(minutes)
  return (
    <HourHistogram
      minutes={minutes}
      title="Best time of day"
      titleAs="h2"
      subtitle={peak === null ? 'Last 90 days' : `Last 90 days · most around ${hourWord(peak)}`}
      format={durationText}
      tickFormat={minutesTick}
      ticks={niceTimeTicks}
      empty={
        <p className={styles.note}>
          After a few sessions you’ll see which hours of the day you focus most.
        </p>
      }
    />
  )
}

/** Focus minutes by hour of the day over the last 90 days. */
export function HoursSection() {
  const env = useProgressEnv()
  return (
    <section className={styles.section} aria-label="Best time of day" data-section="hours">
      <SectionBoundary what="best time of day">
        {env ? <HoursBody today={env.today} /> : <ChartSkeleton what="best time of day" />}
      </SectionBoundary>
    </section>
  )
}
