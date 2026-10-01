import { format } from 'date-fns'
import { useMemo } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { useRedemptions, useRewards } from '@/db/hooks/useRewards'
import { fromISODate } from '@/logic/dates'
import {
  DEFAULT_REWARD_ICON,
  formatXpNumber,
  groupRedemptionsByMonth,
  redemptionTotals,
} from '@/logic/rewards'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import { RedemptionEmpty } from './RewardsStates'
import styles from './RedemptionHistory.module.css'

/** The History tab: what you spent this month and in all, then every redemption, newest first. */
export function RedemptionHistory() {
  const today = useToday()
  const redemptions = useRedemptions()
  const rewards = useRewards()

  const totals = useMemo(() => redemptionTotals(redemptions ?? [], today), [redemptions, today])
  const months = useMemo(() => groupRedemptionsByMonth(redemptions ?? []), [redemptions])
  const icons = useMemo(() => new Map((rewards ?? []).map((r) => [r.id, r.icon])), [rewards])

  if (redemptions === undefined || rewards === undefined) return <HistorySkeleton />
  if (redemptions.length === 0) return <RedemptionEmpty />

  return (
    <div className={styles.root}>
      <dl className={styles.totals}>
        <div className={styles.total}>
          <dt className={styles.caption}>Spent this month</dt>
          <dd className={styles.amount} data-testid="history-month">
            {formatXpNumber(totals.spentThisMonth)} XP
          </dd>
        </div>
        <div className={styles.total}>
          <dt className={styles.caption}>Spent all time</dt>
          <dd className={styles.amount} data-testid="history-all">
            {formatXpNumber(totals.spentAllTime)} XP
          </dd>
        </div>
        <div className={styles.total}>
          <dt className={styles.caption}>Redeemed</dt>
          <dd className={styles.count}>{totals.redeemedCount}</dd>
        </div>
      </dl>

      {months.map((group) => (
        <section key={group.month} className={styles.month} aria-label={monthLabel(group.month)}>
          <h2 className={styles.monthTitle}>
            {monthLabel(group.month)}
            <span className={styles.monthSpent}>{formatXpNumber(group.spent)} XP</span>
          </h2>
          <ul className={styles.list}>
            {group.items.map((r) => {
              const refunded = r.refundedAt !== null
              return (
                <li key={r.id} className={styles.item} data-refunded={refunded || undefined}>
                  <span className={styles.icon} aria-hidden="true">
                    {icons.get(r.rewardId) ?? DEFAULT_REWARD_ICON}
                  </span>
                  <span className={styles.main}>
                    <span className={styles.title}>{r.rewardTitle}</span>
                    <time className={styles.when} dateTime={new Date(r.at).toISOString()}>
                      {format(new Date(r.at), 'EEE, MMM d · h:mm a')}
                    </time>
                  </span>
                  {refunded ? (
                    <Tag color="gray" size="sm">
                      Refunded
                    </Tag>
                  ) : null}
                  <span className={styles.price}>
                    {refunded ? '' : '−'}
                    {formatXpNumber(r.price)} XP
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

const monthLabel = (month: string): string => format(fromISODate(`${month}-01`), 'MMMM yyyy')

function HistorySkeleton() {
  return (
    <div className={styles.root} role="status" aria-busy="true" aria-label="Loading history">
      <div className={styles.totals}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={styles.total}>
            <Skeleton width={96} />
            <Skeleton variant="block" width={88} height={28} />
          </div>
        ))}
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={styles.item}>
          <Skeleton variant="circle" width={28} />
          <span className={styles.main}>
            <Skeleton width={i % 2 === 0 ? '40%' : '54%'} />
            <Skeleton width={120} />
          </span>
          <Skeleton width={64} />
        </div>
      ))}
    </div>
  )
}
