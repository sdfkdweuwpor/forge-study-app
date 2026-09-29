/**
 * The built-in figures of the `today.header` slot: daily goal ring, streak flame, XP today. Each is its
 * own slot contribution (see `feature.ts`), so a later phase can add a fourth beside them, and each
 * reads its number through a hook in `queries.ts` that the phase owning that data can re-point.
 */
import { Flame, Zap } from 'lucide-react'
import { useToday } from '@/app/hooks/useToday'
import { useSettings } from '@/db/hooks/useSettings'
import { useXpSummary } from '@/db/hooks/useXpSummary'
import { ProgressRing } from '@/ui/ProgressRing'
import { Skeleton } from '@/ui/Skeleton'
import { useStreak, useTodayPomodoros } from './queries'
import { TodayStat } from './Stat'
import styles from './Stat.module.css'

function StatSkeleton() {
  return (
    <div className={styles.stat} aria-hidden="true">
      <Skeleton variant="circle" width={32} />
      <Skeleton width={72} lines={2} />
    </div>
  )
}

/** Pomodoros finished today against the daily goal from Settings. */
export function DailyGoalStat() {
  const today = useToday()
  const settings = useSettings()
  const pomodoroMin = settings?.timer.pomodoroMin ?? 25
  const done = useTodayPomodoros(today, pomodoroMin)
  if (!settings || done === undefined) return <StatSkeleton />

  const goal = Math.max(1, settings.dailyGoalPomodoros)
  const reached = done >= goal
  return (
    <TodayStat
      visual={
        <ProgressRing
          size={32}
          stroke={4}
          value={done}
          max={goal}
          tone={reached ? 'success' : 'accent'}
          label="Daily goal"
          valueText={`${done} of ${goal} pomodoros`}
        />
      }
      value={`${done} of ${goal}`}
      caption={reached ? 'Daily goal reached' : 'Daily goal'}
    />
  )
}

/** Consecutive days that counted. The flame is lit while a streak is running. */
export function StreakStat() {
  const today = useToday()
  const streak = useStreak(today)
  if (streak === undefined) return <StatSkeleton />

  return (
    <TodayStat
      visual={
        <Flame
          className={styles.flame}
          data-lit={streak > 0 || undefined}
          size={22}
          strokeWidth={1.9}
          aria-hidden="true"
        />
      }
      value={streak}
      caption="day streak"
    />
  )
}

/** XP earned today, in gold. */
export function XpTodayStat() {
  const today = useToday()
  const summary = useXpSummary(today)
  if (!summary) return <StatSkeleton />

  const xp = summary.today
  return (
    <TodayStat
      tone="xp"
      visual={<Zap className={styles.bolt} size={22} strokeWidth={1.9} aria-hidden="true" />}
      value={`${xp > 0 ? '+' : ''}${xp.toLocaleString('en-US')} XP`}
      caption="earned today"
    />
  )
}
