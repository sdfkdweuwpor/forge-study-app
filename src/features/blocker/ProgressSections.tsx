/**
 * Contributions to the Progress page (`progress.sections`): blocked attempts over the last 30 days by
 * site, and the emergency-unlock log. Both only show once the extension is connected or has reported
 * something, so a person who never set it up doesn't get two empty sections.
 *
 * Wording is deliberate. Attempts are wins. The unlock log is a plain record for your own reference:
 * when, which site, how many minutes. No judgement in either.
 */
import { format } from 'date-fns'
import { useMemo, useState, type ReactNode } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useToday } from '@/app/hooks/useToday'
import { attemptsInLastDays, timesText, unlockLog, winsText } from '@/logic/blockerStats'
import { Button } from '@/ui/Button'
import { HBarList } from '@/ui/charts'
import { Skeleton } from '@/ui/Skeleton'
import { Favicon } from './Favicon'
import { useRecentBlockEvents, useUnlockEvents } from './queries'
import { SectionError } from './Section'
import { useBlockerActive } from './useBlockerActive'
import styles from './ProgressSections.module.css'

const DAYS = 30
const UNLOCKS_SHOWN = 8

function Shell({ what, children }: { what: string; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <ErrorBoundary fallback={(_e, reset) => <SectionError what={what} onRetry={reset} />}>
        {children}
      </ErrorBoundary>
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true" aria-label={label}>
      <Skeleton width={160} />
      <Skeleton width="80%" />
      <Skeleton width="55%" />
    </div>
  )
}

function Attempts() {
  const today = useToday()
  const events = useRecentBlockEvents(today, DAYS)
  const summary = useMemo(
    () => (events ? attemptsInLastDays(events, today, DAYS) : null),
    [events, today],
  )
  if (summary === null) return <Loading label="Loading blocked attempts" />
  return (
    <HBarList
      title="Blocked attempts"
      titleAs="h2"
      subtitle={`Last ${DAYS} days · ${winsText(summary.total)} for your focus`}
      items={summary.sites.map((s) => ({
        id: s.domain,
        label: s.name,
        value: s.count,
        color: 'blue',
      }))}
      format={timesText}
      labelHeader="Site"
      valueHeader="Blocked"
      emptyText="Nothing was blocked in the last 30 days. When the blocker steps in, each time counts as a win here."
    />
  )
}

/** Blocked attempts over the last 30 days, by site. */
export function BlockedAttemptsSection() {
  const active = useBlockerActive()
  if (!active) return null
  return (
    <Shell what="blocked attempts">
      <Attempts />
    </Shell>
  )
}

function Unlocks() {
  const events = useUnlockEvents()
  const [all, setAll] = useState(false)
  const log = useMemo(() => (events ? unlockLog(events, 500) : null), [events])
  if (log === null) return <Loading label="Loading emergency unlocks" />
  const shown = all ? log : log.slice(0, UNLOCKS_SHOWN)
  return (
    <>
      <div>
        <h2 className={styles.heading}>Emergency unlocks</h2>
        <p className={styles.note}>
          A plain record of the times a blocked site was opened early, kept for your own reference.
        </p>
      </div>
      {log.length === 0 ? (
        <p className={styles.note}>No emergency unlocks logged.</p>
      ) : (
        <>
          <table className={styles.table}>
            <caption className="sr-only">Emergency unlocks, newest first</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">When</th>
                <th scope="col">Site</th>
                <th scope="col">Access</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id}>
                  <td className={styles.when}>{format(u.at, 'EEE, MMM d · h:mm a')}</td>
                  <td>
                    <span className={styles.site}>
                      <Favicon domain={u.domain} size={16} />
                      <span>{u.domain}</span>
                    </span>
                  </td>
                  <td className={styles.minutes}>{u.minutes} min</td>
                </tr>
              ))}
            </tbody>
          </table>
          {log.length > UNLOCKS_SHOWN ? (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
                {all ? 'Show fewer' : `Show all ${log.length}`}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  )
}

/** The emergency-unlock log: date, site, minutes. */
export function UnlockLogSection() {
  const active = useBlockerActive()
  if (!active) return null
  return (
    <Shell what="emergency unlocks">
      <Unlocks />
    </Shell>
  )
}
