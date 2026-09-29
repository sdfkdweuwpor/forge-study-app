/**
 * Today's session log (BRIEF §5.2): for each finished focus session its start and end, the task,
 * planned against actual minutes, and whether it was interrupted or did not count. Newest first, with
 * a one-line summary. Empty, loading and error states are all here.
 */
import { CircleAlert, Timer } from 'lucide-react'
import { useMemo } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import type { ID, ISODate, Session } from '@/db/types'
import { earnedXp, formatMinutes, formatSpan } from '@/logic/timer'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import { useSessionsOn, useTaskTitles } from './queries'
import styles from './SessionLog.module.css'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Finished focus sessions, newest first. Breaks and thrown-away sessions are not part of the log. */
function loggable(sessions: readonly Session[]): Session[] {
  return sessions
    .filter((s) => s.kind === 'focus' && s.status === 'completed')
    .sort((a, b) => b.startedAt - a.startedAt)
}

export function SessionLog({ day }: { day: ISODate }) {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <section className={styles.log} aria-labelledby="focus-log-title">
          <h2 className={styles.title} id="focus-log-title">
            Today
          </h2>
          <EmptyState
            size="sm"
            icon={<CircleAlert />}
            title="Couldn’t load today’s sessions"
            description="Your data is safe on this device. Try again, or reload the page."
            action={
              <Button variant="secondary" size="sm" onClick={reset}>
                Try again
              </Button>
            }
          />
        </section>
      )}
    >
      <LogBody day={day} />
    </ErrorBoundary>
  )
}

function LogBody({ day }: { day: ISODate }) {
  const sessions = useSessionsOn(day)
  const rows = useMemo(() => (sessions ? loggable(sessions) : undefined), [sessions])
  const taskIds = useMemo<ID[]>(
    () => (rows ?? []).flatMap((s) => (s.taskId ? [s.taskId] : [])),
    [rows],
  )
  const titles = useTaskTitles(taskIds)

  if (rows === undefined || (taskIds.length > 0 && titles === undefined)) {
    return (
      <section className={styles.log} aria-labelledby="focus-log-title">
        <h2 className={styles.title} id="focus-log-title">
          Today
        </h2>
        <div className={styles.skeleton} role="status" aria-busy="true" aria-label="Loading today’s sessions">
          {[64, 48, 56].map((width) => (
            <Skeleton key={width} width={`${width}%`} />
          ))}
        </div>
      </section>
    )
  }

  const minutes = rows.reduce((sum, s) => sum + (s.actualMinutes ?? 0), 0)
  const xp = rows.reduce((sum, s) => sum + earnedXp(s), 0)

  return (
    <section className={styles.log} aria-labelledby="focus-log-title" data-testid="session-log">
      <div className={styles.head}>
        <h2 className={styles.title} id="focus-log-title">
          Today
        </h2>
        {rows.length > 0 ? (
          <p className={styles.summary}>
            {plural(rows.length, 'session')} · {formatMinutes(minutes)} focused
            {xp > 0 ? <span className={styles.xp}> · +{xp} XP</span> : null}
          </p>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Timer />}
          title="No sessions yet today"
          description="Start a pomodoro and it lands here, with what you worked on and how long you held."
        />
      ) : (
        <ul className={styles.list}>
          {rows.map((s) => {
            const title = s.taskId ? titles?.get(s.taskId) : undefined
            return (
              <li key={s.id} className={styles.row} data-testid="session-row">
                <span className={styles.when}>{formatSpan(s.startedAt, s.endedAt)}</span>
                <span className={styles.task} data-empty={!s.taskId || undefined}>
                  {s.taskId ? (title ?? 'Deleted task') : 'No task'}
                </span>
                <span className={styles.amount}>
                  {s.plannedMinutes === null
                    ? formatMinutes(s.actualMinutes ?? 0)
                    : `${s.actualMinutes ?? 0} of ${s.plannedMinutes} min`}
                </span>
                <span className={styles.badges}>
                  {s.interrupted ? (
                    <Tag size="sm" color="orange">
                      Interrupted
                    </Tag>
                  ) : null}
                  {!s.counted ? (
                    <Tag size="sm" color="gray">
                      Not counted
                    </Tag>
                  ) : (
                    <span className={styles.xpBadge}>+{earnedXp(s)} XP</span>
                  )}
                </span>
                {s.note ? <span className={styles.note}>{s.note}</span> : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
