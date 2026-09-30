import { useMemo } from 'react'
import { buildProgressSample } from '@/data/sample/progressSample'
import { addDays } from '@/logic/dates'
import {
  estimateAccuracy,
  focusMinutesByDay,
  focusMinutesMap,
  hourHistogram,
  minutesByCourse,
  tasksCompletedByWeek,
  yearHeatmap,
} from '@/logic/stats'
import { dayBars, durationText, minutesTick, weekBars } from '@/logic/statsLabels'
import {
  AccuracyScatter,
  BarChart,
  HBarList,
  Heatmap,
  HourHistogram,
  Sparkline,
  niceTimeTicks,
} from '@/ui/charts'
import type { DemoSection } from '../types'
import styles from './Charts.demo.module.css'

/** The same fixed day the screenshots use, so the demo never changes under its own feet. */
const TODAY = '2026-09-29'

const COURSES = [
  { id: 'course-c182', title: 'C182 Introduction to IT', color: 'gray' },
  { id: 'course-c779', title: 'C779 Web Development Foundations', color: 'blue' },
  { id: 'course-d278', title: 'D278 Scripting and Programming Foundations', color: 'green' },
  { id: 'course-c172', title: 'C172 Network and Security Foundations', color: 'orange' },
] as const

/** Streak freezes (one a week at most), as the streak engine would report them. */
const FROZEN = new Set(['2026-09-13', '2026-08-23', '2026-08-02', '2026-06-14', '2026-04-05'])

function useSample() {
  return useMemo(() => {
    const { sessions, tasks } = buildProgressSample({ today: TODAY })
    const days = focusMinutesByDay(sessions, TODAY, 30)
    const weeks = tasksCompletedByWeek(tasks, TODAY, 12, 1)
    const heat = yearHeatmap(focusMinutesMap(sessions), FROZEN, TODAY, 1)
    const hours = hourHistogram(sessions, { from: addDays(TODAY, -89), to: TODAY })
    const courses = minutesByCourse(sessions, COURSES, { from: addDays(TODAY, -29), to: TODAY })
    const accuracy = estimateAccuracy(tasks, sessions)
    return { days, weeks, heat, hours, courses, accuracy }
  }, [])
}

function Block({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className={styles.block}>
      <span className={styles.caption}>{caption}</span>
      {children}
    </div>
  )
}

function ChartsDemo() {
  const { days, weeks, heat, hours, courses, accuracy } = useSample()
  return (
    <div className={styles.stack}>
      <Block caption="Year heatmap: shade = focused minutes (quartiles of the days shown), ❄ = a streak freeze. Arrow keys: ←/→ change week, ↑/↓ change day, Esc hides the tooltip">
        <Heatmap
          weeks={heat.weeks}
          weekStartsOn={1}
          title="Focus, past year"
          subtitle={`${heat.activeDays} days with focus`}
          format={durationText}
        />
      </Block>

      <Block caption="Bar chart: focus minutes per day, today in the full accent. Focus the chart and use ←/→">
        <BarChart
          data={dayBars(days)}
          title="Focus minutes"
          subtitle="Last 30 days"
          highlightKey={TODAY}
          format={durationText}
          tickFormat={minutesTick}
          ticks={niceTimeTicks}
          labelHeader="Day"
          valueHeader="Focus time"
        />
      </Block>

      <Block caption="Bar chart with whole-number steps: tasks per week">
        <BarChart
          data={weekBars(weeks, TODAY, 1)}
          title="Tasks finished"
          subtitle="Last 12 weeks"
          highlightKey={weeks[weeks.length - 1]?.weekStart}
          integerTicks
          format={(n) => `${n} ${n === 1 ? 'task' : 'tasks'}`}
          tickFormat={String}
          labelHeader="Week"
          valueHeader="Tasks"
        />
      </Block>

      <Block caption="Hour histogram: the busiest hour is the full accent">
        <HourHistogram
          minutes={hours}
          title="Best time of day"
          subtitle="Last 90 days"
          format={durationText}
          tickFormat={minutesTick}
          ticks={niceTimeTicks}
        />
      </Block>

      <Block caption="Ranked list: one tag colour per row, value on the right, share in the tooltip">
        <HBarList
          title="Time per course"
          subtitle="Last 30 days"
          items={courses.map((c) => ({
            id: c.id ?? 'other',
            label: c.title,
            value: c.minutes,
            color: c.color,
          }))}
          format={durationText}
          labelHeader="Course"
          valueHeader="Focus time"
        />
      </Block>

      <Block caption="Scatter: filled = within ±20% of the estimate, open ring = outside; never red">
        <AccuracyScatter
          title="Estimate accuracy"
          subtitle="Planned against actual pomodoros"
          points={accuracy.points.map((p) => ({
            id: p.taskId,
            label: p.taskId,
            planned: p.planned,
            actual: p.actual,
          }))}
        />
      </Block>

      <Block caption="Sparkline: decorative, with a hidden sentence. Rising, all zeros, one value, no data">
        <div className={styles.spark}>
          <span className={styles.sparkItem}>
            <Sparkline values={days.map((d) => d.minutes)} label="Focus minutes, last 30 days" />
            142 h
          </span>
          <span className={styles.sparkItem}>
            <Sparkline values={[0, 0, 0, 0, 0, 0]} label="Focus minutes" />0 h
          </span>
          <span className={styles.sparkItem}>
            <Sparkline values={[25]} label="Focus minutes" />
            25 min
          </span>
          <span className={styles.sparkItem}>
            <Sparkline values={[]} label="Focus minutes" />
            none
          </span>
        </div>
      </Block>

      <Block caption="In a 320 px column: the heatmap shows the most recent weeks that fit, the axis labels thin out">
        <div className={styles.narrow}>
          <div className={styles.stack}>
            <Heatmap
              weeks={heat.weeks}
              weekStartsOn={1}
              title="Focus, past year"
              format={durationText}
            />
            <BarChart
              data={dayBars(days)}
              title="Focus minutes"
              subtitle="Last 30 days"
              highlightKey={TODAY}
              format={durationText}
              tickFormat={minutesTick}
              ticks={niceTimeTicks}
            />
          </div>
        </div>
      </Block>

      <Block caption="Empty states: a calm line, never an empty frame">
        <div className={styles.pair}>
          <BarChart
            data={dayBars(days.map((d) => ({ ...d, minutes: 0 })))}
            title="Focus minutes"
            subtitle="Last 30 days"
            emptyText="Your first focus session will show up here."
          />
          <HourHistogram minutes={new Array<number>(24).fill(0)} title="Best time of day" />
          <HBarList
            title="Time per goal"
            items={[]}
            emptyText="No focus time in the last 30 days."
          />
          <AccuracyScatter
            title="Estimate accuracy"
            points={[]}
            emptyText="Finish a task you gave an estimate to see how it compares."
          />
        </div>
      </Block>
    </div>
  )
}

const section: DemoSection = {
  id: 'charts',
  title: 'Charts',
  group: 'Composites',
  order: 60,
  description:
    'Hand-made SVG charts for the Progress page: one tab stop per chart (arrow keys, tooltip, Esc), a hidden data table, an empty state, tokens only.',
  render: () => <ChartsDemo />,
}

export default section
