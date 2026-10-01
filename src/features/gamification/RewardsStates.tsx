import { CircleAlert, Gift, History, Plus } from 'lucide-react'
import { navigate } from '@/app/router'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Kbd } from '@/ui/Kbd'
import { Skeleton } from '@/ui/Skeleton'
import styles from './RewardsStates.module.css'

/** The shop while rewards and XP load: the balance's footprint and three reward rows. */
export function RewardsSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true" aria-label="Loading rewards">
      <div className={styles.balance}>
        <Skeleton width={72} />
        <Skeleton width={148} height={32} variant="block" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.row}>
          <Skeleton variant="circle" width={36} />
          <div className={styles.rowText}>
            <Skeleton width={i === 1 ? '34%' : '46%'} />
            <Skeleton width={72} />
          </div>
          <Skeleton variant="block" width={76} height={32} />
        </div>
      ))}
    </div>
  )
}

/** Reading rewards failed. The data is untouched, so the only step is to try again. */
export function RewardsError({
  onRetry,
  what = 'rewards',
}: {
  onRetry: () => void
  what?: string
}) {
  return (
    <EmptyState
      titleAs="h2"
      icon={<CircleAlert />}
      title={`Couldn’t load your ${what}`}
      description="Your XP and rewards are safe on this device. Try again, or reload the page."
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  )
}

/** No rewards on sale: one action, with the examples from the brief to start from. */
export function RewardsEmpty({ onNew }: { onNew: () => void }) {
  return (
    <EmptyState
      titleAs="h2"
      icon={<Gift />}
      title="Add a reward worth working for"
      description="Name something you enjoy and price it in XP, like takeout for 1,500 XP."
      action={
        <>
          <Button variant="primary" iconLeft={<Plus />} onClick={onNew}>
            New reward
          </Button>
          <span className={styles.hint}>
            or press <Kbd keys="n" size="sm" />
          </span>
        </>
      }
    />
  )
}

/** Nothing redeemed yet (or everything was refunded away: refunded rows still list, so this is only "never"). */
export function RedemptionEmpty() {
  return (
    <EmptyState
      titleAs="h2"
      icon={<History />}
      title="Nothing redeemed yet"
      description="When you spend XP on a reward, it shows up here with the date and the price."
      action={
        <Button variant="secondary" onClick={() => navigate('rewards', { tab: 'shop' })}>
          Browse the shop
        </Button>
      }
    />
  )
}
