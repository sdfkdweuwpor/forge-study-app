import { useMemo } from 'react'
import { useStreak } from '@/db/hooks/useStreak'
import { useXpSummary } from '@/db/hooks/useXpSummary'
import type { ISODate } from '@/db/types'
import { addDays, startOfWeekISO, type WeekStart } from '@/logic/dates'
import { focusMinutesByDay } from '@/logic/stats'
import { hoursText } from '@/logic/statsLabels'
import { ProgressBar } from '@/ui/ProgressBar'
import { Skeleton } from '@/ui/Skeleton'
import { Sparkline } from '@/ui/charts'
import { useDoneTasks, useFocusSessions, useLifetimeTotals, type LifetimeTotals } from '../queries'
import { SectionBoundary } from './SectionStates'
import { useProgressEnv } from './useProgressEnv'
import styles from './SummarySection.module.css'

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`

interface StatProps {
  label: string
  value: string
  note?: string
  /** Something small beside the value: a sparkline. */
  visual?: React.ReactNode
  children?: React.ReactNode
  testId: string
}

function Stat({ label, value, note, visual, children, testId }: StatProps) {
  return (
    <li className={styles.stat} data-testid={testId}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>
        <span>{value}</span>
        {visual}
      </span>
      {note && <span className={styles.note}>{note}</span>}
      {children}
    </li>
  )
}

function StatSkeleton({ label }: { label: string }) {
  return (
    <li className={styles.stat} role="status" aria-busy="true" aria-label={`Loading ${label}`}>
      <Skeleton width={72} />
      <Skeleton variant="block" width={96} height={28} />
      <Skeleton width={110} />
    </li>
  )
}

function StreakStat({ today }: { today: ISODate }) {
  const streak = useStreak(today)
  if (!streak) return <StatSkeleton label="streak" />
  return (
    <Stat
      testId="stat-streak"
      label="Streak"
      value={plural(streak.current, 'day', 'days')}
      note={
        streak.best > 0
          ? `Best: ${plural(streak.best, 'day', 'days')}`
          : 'One focus session starts a streak'
      }
    />
  )
}

function FocusStat({ today, totals }: { today: ISODate; totals: LifetimeTotals }) {
  const sessions = useFocusSessions(addDays(today, -29), today)
  const values = useMemo(
    () => (sessions ? focusMinutesByDay(sessions, today, 30).map((d) => d.minutes) : undefined),
    [sessions, today],
  )
  return (
    <Stat
      testId="stat-focus"
      label="Focused, all time"
      value={hoursText(totals.focusMinutes)}
      note={plural(totals.sessions, 'session', 'sessions')}
      visual={
        values ? <Sparkline values={values} label="Focus minutes, last 30 days" /> : undefined
      }
    />
  )
}

function TasksStat({
  today,
  weekStartsOn,
  totals,
}: {
  today: ISODate
  weekStartsOn: WeekStart
  totals: LifetimeTotals
}) {
  const week = useDoneTasks(startOfWeekISO(today, weekStartsOn), today)
  return (
    <Stat
      testId="stat-tasks"
      label="Tasks done"
      value={totals.tasksDone.toLocaleString()}
      note={week ? `${week.length.toLocaleString()} this week` : undefined}
    />
  )
}

function LevelStat({ today }: { today: ISODate }) {
  const xp = useXpSummary(today)
  if (!xp) return <StatSkeleton label="level" />
  const { level } = xp
  return (
    <Stat
      testId="stat-level"
      label="Level"
      value={String(level.level)}
      note={`${level.intoLevel.toLocaleString()} / ${level.needed.toLocaleString()} XP`}
    >
      <ProgressBar
        className={styles.bar}
        size="sm"
        tone="xp"
        value={level.intoLevel}
        max={level.needed}
        label={`Level ${level.level} progress`}
        valueText={`${level.intoLevel.toLocaleString()} of ${level.needed.toLocaleString()} XP`}
      />
    </Stat>
  )
}

/** The header: streak, lifetime focus, tasks done and level. Each figure loads on its own. */
export function SummarySection() {
  const env = useProgressEnv()
  const totals = useLifetimeTotals()
  return (
    <SectionBoundary what="your totals">
      <ul className={styles.stats} aria-label="Totals">
        {env ? <StreakStat today={env.today} /> : <StatSkeleton label="streak" />}
        {env && totals ? (
          <FocusStat today={env.today} totals={totals} />
        ) : (
          <StatSkeleton label="focus time" />
        )}
        {env && totals ? (
          <TasksStat today={env.today} weekStartsOn={env.weekStartsOn} totals={totals} />
        ) : (
          <StatSkeleton label="tasks" />
        )}
        {env ? <LevelStat today={env.today} /> : <StatSkeleton label="level" />}
      </ul>
    </SectionBoundary>
  )
}
