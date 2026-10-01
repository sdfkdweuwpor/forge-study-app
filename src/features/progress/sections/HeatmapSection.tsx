import { useMemo } from 'react'
import { Link } from '@/app/router'
import { useStreak } from '@/db/hooks/useStreak'
import { addDays, startOfWeekISO, type WeekStart } from '@/logic/dates'
import { focusMinutesMap, yearHeatmap } from '@/logic/stats'
import { durationText, hoursText } from '@/logic/statsLabels'
import type { ISODate } from '@/db/types'
import { Heatmap } from '@/ui/charts'
import { useFocusSessions } from '../queries'
import { ChartSkeleton, SectionBoundary } from './SectionStates'
import { useProgressEnv } from './useProgressEnv'
import styles from './sections.module.css'

const WEEKS = 53

function HeatmapBody({ today, weekStartsOn }: { today: ISODate; weekStartsOn: WeekStart }) {
  const from = addDays(startOfWeekISO(today, weekStartsOn), -(WEEKS - 1) * 7)
  const sessions = useFocusSessions(from, today)
  const streak = useStreak(today)

  const heat = useMemo(() => {
    if (!sessions || !streak) return undefined
    const frozen = new Set(streak.days.filter((d) => d.status === 'frozen').map((d) => d.day))
    return yearHeatmap(focusMinutesMap(sessions), frozen, today, weekStartsOn, WEEKS)
  }, [sessions, streak, today, weekStartsOn])

  if (!heat) return <ChartSkeleton what="the yearly heatmap" height={140} />
  return (
    <Heatmap
      weeks={heat.weeks}
      weekStartsOn={weekStartsOn}
      title="Focus, past year"
      titleAs="h2"
      subtitle={
        heat.activeDays > 0
          ? `${heat.activeDays} ${heat.activeDays === 1 ? 'day' : 'days'} with focus · ${hoursText(heat.totalMinutes)}`
          : undefined
      }
      format={durationText}
      empty={
        <p className={styles.note}>
          Each day you focus colors a square.{' '}
          <Link to="focus" className={styles.link}>
            Start a session
          </Link>{' '}
          and today’s will light up.
        </p>
      }
    />
  )
}

/** The year at a glance: a GitHub-style grid, colour = focused minutes, ❄ = a streak freeze. */
export function HeatmapSection() {
  const env = useProgressEnv()
  return (
    <section className={styles.section} aria-label="Focus, past year" data-section="heatmap">
      <SectionBoundary what="the yearly heatmap">
        {env ? (
          <HeatmapBody today={env.today} weekStartsOn={env.weekStartsOn} />
        ) : (
          <ChartSkeleton what="the yearly heatmap" height={140} />
        )}
      </SectionBoundary>
    </section>
  )
}
