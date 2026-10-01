import { useMemo } from 'react'
import { Link } from '@/app/router'
import type { ISODate } from '@/db/types'
import { addDays, startOfWeekISO, type WeekStart } from '@/logic/dates'
import { tasksCompletedByWeek } from '@/logic/stats'
import { weekBars } from '@/logic/statsLabels'
import { BarChart } from '@/ui/charts'
import { useDoneTasks } from '../queries'
import { ChartSkeleton, SectionBoundary } from './SectionStates'
import { useProgressEnv } from './useProgressEnv'
import styles from './sections.module.css'

const WEEKS = 12

const taskCount = (n: number): string => `${n} ${n === 1 ? 'task' : 'tasks'}`

function TasksBody({ today, weekStartsOn }: { today: ISODate; weekStartsOn: WeekStart }) {
  const from = addDays(startOfWeekISO(today, weekStartsOn), -(WEEKS - 1) * 7)
  const tasks = useDoneTasks(from, today)
  const weeks = useMemo(
    () => (tasks ? tasksCompletedByWeek(tasks, today, WEEKS, weekStartsOn) : undefined),
    [tasks, today, weekStartsOn],
  )
  if (!weeks) return <ChartSkeleton what="tasks per week" />

  const total = weeks.reduce((sum, w) => sum + w.count, 0)
  return (
    <BarChart
      data={weekBars(weeks, today, weekStartsOn)}
      title="Tasks finished"
      titleAs="h2"
      subtitle={total > 0 ? `Last 12 weeks · ${taskCount(total)}` : 'Last 12 weeks'}
      highlightKey={weeks[weeks.length - 1]?.weekStart}
      integerTicks
      format={taskCount}
      tickFormat={String}
      labelHeader="Week"
      valueHeader="Tasks finished"
      empty={
        <p className={styles.note}>
          Tasks you check off will be counted here, week by week.{' '}
          <Link to="tasks" params={{ list: 'inbox' }} className={styles.link}>
            Open your tasks
          </Link>
          .
        </p>
      }
    />
  )
}

/** Finished tasks per week for the last 12 weeks (the current week is still filling up). */
export function TasksSection() {
  const env = useProgressEnv()
  return (
    <section className={styles.section} aria-label="Tasks finished" data-section="tasks-weeks">
      <SectionBoundary what="tasks per week">
        {env ? (
          <TasksBody today={env.today} weekStartsOn={env.weekStartsOn} />
        ) : (
          <ChartSkeleton what="tasks per week" />
        )}
      </SectionBoundary>
    </section>
  )
}
