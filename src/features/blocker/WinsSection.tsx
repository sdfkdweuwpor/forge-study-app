import { ShieldCheck } from 'lucide-react'
import { useMemo } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { attemptsOn, todayHeadline, timesText } from '@/logic/blockerStats'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { useConnection } from './connection'
import { Favicon } from './Favicon'
import { useHasBlockEvents, useBlockEvents } from './queries'
import { Section } from './Section'
import styles from './WinsSection.module.css'

/**
 * Today's blocked attempts, framed as wins: "You tried Instagram 7 times today, that's 7 wins", then
 * every site with its count. Never shaming: a quiet day is a calm sentence, not a blank.
 */
export function WinsSection() {
  const today = useToday()
  const events = useBlockEvents(today)
  const anyEvents = useHasBlockEvents()
  const conn = useConnection()
  const summary = useMemo(() => (events ? attemptsOn(events, today) : null), [events, today])

  return (
    <Section
      id="today"
      title="Today’s wins"
      description="Every time the blocker stops you, that’s a win for your focus."
    >
      {summary === null || anyEvents === undefined ? (
        <div
          className={styles.skeleton}
          role="status"
          aria-busy="true"
          aria-label="Loading today’s wins"
        >
          <Skeleton width={72} height={32} variant="block" />
          <Skeleton width="60%" />
        </div>
      ) : summary.total === 0 && !anyEvents && conn.phase !== 'connected' ? (
        <EmptyState
          size="sm"
          align="start"
          titleAs="h3"
          icon={<ShieldCheck />}
          title="Your wins will show up here"
          description="Once the extension is installed, each blocked attempt counts as a win."
        />
      ) : (
        <div className={styles.body}>
          <div className={styles.lead}>
            <div className={styles.total}>
              <p className={styles.number}>{summary.total}</p>
              <p className={styles.label}>{summary.total === 1 ? 'win' : 'wins'} today</p>
            </div>
            <p className={styles.headline}>{todayHeadline(summary)}</p>
          </div>
          {summary.sites.length > 0 ? (
            <ul className={styles.sites} aria-label="Blocked attempts today, by site">
              {summary.sites.map((site) => (
                <li key={site.domain} className={styles.site}>
                  <Favicon domain={site.domain} />
                  <span className={styles.name}>{site.name}</span>
                  <span className={styles.count}>{timesText(site.count)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Section>
  )
}
