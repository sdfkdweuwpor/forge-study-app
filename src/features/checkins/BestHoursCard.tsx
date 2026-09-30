import { CircleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import type { CheckIn } from '@/db/types'
import {
  bestFocusHours,
  bestWeekdays,
  hourLabel,
  suggestHardTaskSlots,
  weekdayName,
} from '@/logic/insights'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { HBarList, type HBarItem } from '@/ui/charts'
import { Skeleton } from '@/ui/Skeleton'
import { useCheckIns } from './queries'
import styles from './BestHoursCard.module.css'

const outOfFive = (value: number): string => `${value.toFixed(1)} of 5`
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Slot `progress.sections`: "When you focus best". Your top hours and weekdays by how you rated your
 * focus, once an hour has three ratings; until then one gentle line, with no count of what is missing.
 * It says what Forge does with it (plans your best hour first) and never scores you.
 */
export function BestHoursCard() {
  return (
    <section className={styles.section} aria-label="When you focus best" data-testid="best-hours">
      <ErrorBoundary
        fallback={(_error, reset) => (
          <EmptyState
            size="sm"
            align="start"
            titleAs="h2"
            icon={<CircleAlert />}
            title="Couldn’t load when you focus best"
            description="Your data is safe on this device. Try again, or reload the page."
            action={
              <Button variant="secondary" size="sm" onClick={reset}>
                Try again
              </Button>
            }
          />
        )}
      >
        <BestHoursBody />
      </ErrorBoundary>
    </section>
  )
}

function BestHoursBody() {
  const checkIns = useCheckIns()
  if (checkIns === undefined) {
    return (
      <div
        className={styles.skeleton}
        role="status"
        aria-busy="true"
        aria-label="Loading check-ins"
      >
        <Skeleton width={160} />
        <Skeleton variant="block" height={120} />
      </div>
    )
  }
  return <Loaded checkIns={checkIns} />
}

function Loaded({ checkIns }: { checkIns: readonly CheckIn[] }) {
  const { hours, days, slots } = useMemo(
    () => ({
      hours: bestFocusHours(checkIns),
      days: bestWeekdays(checkIns),
      slots: suggestHardTaskSlots(checkIns),
    }),
    [checkIns],
  )

  if (hours.length === 0) {
    return (
      <>
        <h2 className={styles.heading}>When you focus best</h2>
        <p className={styles.note}>Rate a few sessions to see your best hours.</p>
        <p className={styles.quiet}>
          After a focus session, a quick 1 to 5 is all it takes. Skip it whenever you like.
        </p>
      </>
    )
  }

  const hourItems: HBarItem[] = hours.map((h) => ({
    id: `hour-${h.hour}`,
    label: hourLabel(h.hour),
    value: h.avg,
    color: 'green',
  }))
  const dayItems: HBarItem[] = days.map((d) => ({
    id: `day-${d.weekday}`,
    label: weekdayName(d.weekday),
    value: d.avg,
    color: 'blue',
  }))
  const top = hours[0]

  return (
    <>
      <div className={styles.head}>
        <h2 className={styles.heading}>When you focus best</h2>
        <p className={styles.quiet}>
          From {plural(checkIns.length, 'check-in')}. The more you rate, the clearer it gets.
        </p>
      </div>
      <div className={styles.pair}>
        <HBarList
          title="Best hours"
          titleAs="h3"
          items={hourItems}
          format={outOfFive}
          max={5}
          labelHeader="Hour"
          valueHeader="Average focus"
        />
        {dayItems.length > 0 ? (
          <HBarList
            title="Best days"
            titleAs="h3"
            items={dayItems}
            format={outOfFive}
            max={5}
            labelHeader="Day"
            valueHeader="Average focus"
          />
        ) : null}
      </div>
      {slots.length > 0 ? (
        <p className={styles.note}>
          Good times for hard tasks:{' '}
          {slots.map((s) => `${weekdayName(s.weekday, 'short')} ${hourLabel(s.hour)}`).join(', ')}.
        </p>
      ) : null}
      {top ? (
        <p className={styles.quiet}>
          When Forge plans your study time, it starts the day around {hourLabel(top.hour)} if it
          can.
        </p>
      ) : null}
    </>
  )
}
