import { Archive, MoreHorizontal } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import type { Reward } from '@/db/types'
import {
  MAX_REWARD_PRICE,
  MAX_REWARD_TITLE_LENGTH,
  canAfford,
  formatPrice,
  formatXpNumber,
  parseRewardPrice,
  toGoLabel,
} from '@/logic/rewards'
import { Button } from '@/ui/Button'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { IconButton } from '@/ui/IconButton'
import type { RewardActions } from './RewardsActions'
import { RewardsIconPicker } from './RewardsIconPicker'
import { RewardsInline } from './RewardsInline'
import styles from './RewardsCard.module.css'

interface Props {
  reward: Reward
  /** Spendable XP (lifetime minus spent). */
  balance: number
  /** The drag handle from the sortable row. */
  handle: ReactNode
  actions: RewardActions
  /** Opens the confirm dialog. */
  onRedeem: (reward: Reward) => void
}

const priceProblem = (text: string): string | null =>
  parseRewardPrice(text) === null
    ? `Enter a whole number of XP, 1 to ${formatXpNumber(MAX_REWARD_PRICE)}.`
    : null

/**
 * One reward: icon, title and price you edit in place, how far away it is, and Redeem. Not a boxed card:
 * the row is plain until hovered. An unaffordable reward keeps its Redeem button, disabled, with the
 * distance said out loud beside the price.
 */
export function RewardsCard({ reward, balance, handle, actions, onRedeem }: Props) {
  const toGoId = useId()
  const affordable = canAfford(reward.price, balance)
  const toGo = toGoLabel(reward.price, balance)

  const menu: MenuEntry[] = [
    {
      id: 'archive',
      label: 'Archive',
      icon: <Archive />,
      onSelect: () => void actions.archive(reward),
    },
  ]

  return (
    <div className={styles.card} data-affordable={affordable || undefined}>
      <span className={styles.handle}>{handle}</span>
      <RewardsIconPicker
        value={reward.icon}
        rewardTitle={reward.title}
        onPick={(icon) => void actions.save(reward.id, { icon })}
      />
      <div className={styles.main}>
        <div className={styles.title}>
          <RewardsInline
            value={reward.title}
            label={`Title of ${reward.title}`}
            maxLength={MAX_REWARD_TITLE_LENGTH}
            validate={(text) => (text === '' ? 'A reward needs a title.' : null)}
            onCommit={(title) => void actions.save(reward.id, { title })}
          />
        </div>
        <div className={styles.meta}>
          <RewardsInline
            className={styles.price}
            value={String(reward.price)}
            label={`Price of ${reward.title}`}
            display={formatPrice(reward.price)}
            inputMode="numeric"
            size={8}
            suffix="XP"
            validate={priceProblem}
            onCommit={(text) => {
              const price = parseRewardPrice(text)
              if (price !== null) void actions.save(reward.id, { price })
            }}
          />
          {toGo !== null ? (
            <span id={toGoId} className={styles.toGo}>
              {toGo}
            </span>
          ) : null}
        </div>
      </div>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          disabled={!affordable}
          aria-label={`Redeem ${reward.title} for ${formatPrice(reward.price)}`}
          aria-describedby={toGo !== null ? toGoId : undefined}
          onClick={() => onRedeem(reward)}
        >
          Redeem
        </Button>
        <Dropdown
          label={`Actions for ${reward.title}`}
          align="end"
          items={menu}
          trigger={(p) => (
            <IconButton
              {...p}
              className={styles.more}
              label={`Actions for ${reward.title}`}
              icon={<MoreHorizontal />}
              size="sm"
              tooltip={false}
            />
          )}
        />
      </div>
    </div>
  )
}
