import { useMemo, useState } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { useRewards } from '@/db/hooks/useRewards'
import { useXpSummary } from '@/db/hooks/useXpSummary'
import type { ID, Reward } from '@/db/types'
import { shopRewards } from '@/logic/rewards'
import { RewardsArchived } from './RewardsArchived'
import { useRewardActions } from './RewardsActions'
import { RewardsBalance } from './RewardsBalance'
import { RewardsCard } from './RewardsCard'
import { RewardsNewRow } from './RewardsNewRow'
import { RewardsRedeemDialog } from './RewardsRedeemDialog'
import { RewardsSortable } from './RewardsSortable'
import { RewardsEmpty, RewardsSkeleton } from './RewardsStates'
import styles from './RewardsShop.module.css'

interface Props {
  /** Whether the "New reward" row is open (the page owns it so `n` and the palette can open it). */
  creating: boolean
  onCreatingChange: (open: boolean) => void
}

const sameIds = (a: readonly ID[], b: readonly ID[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id))
const sameOrder = (a: readonly ID[], b: readonly ID[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i])

/** The Shop tab: balance, the rewards on sale (edit in place, drag to reorder), a new-reward row, Redeem. */
export function RewardsShop({ creating, onCreatingChange }: Props) {
  const today = useToday()
  const rewards = useRewards()
  const summary = useXpSummary(today)
  const actions = useRewardActions()
  const [dialog, setDialog] = useState<{ reward: Reward; open: boolean } | null>(null)
  // The order a drop asked for, shown until the database catches up (the stored order stops matching
  // `base`) so the row does not jump back and forth.
  const [dropped, setDropped] = useState<{ ids: ID[]; base: ID[] } | null>(null)

  const onSale = useMemo(() => shopRewards(rewards ?? []), [rewards])
  const archived = useMemo(() => (rewards ?? []).filter((r) => r.archived), [rewards])
  const saleIds = useMemo(() => onSale.map((r) => r.id), [onSale])

  if (rewards === undefined || summary === undefined) return <RewardsSkeleton />

  const shown =
    dropped !== null && sameOrder(dropped.base, saleIds) && sameIds(dropped.ids, saleIds)
      ? dropped.ids.flatMap((id) => onSale.filter((r) => r.id === id))
      : onSale

  async function reorder(ids: ID[]) {
    setDropped({ ids, base: saleIds })
    if (!(await actions.reorder(ids))) setDropped(null)
  }

  return (
    <div className={styles.root}>
      <RewardsBalance
        balance={summary.balance}
        lifetime={summary.lifetime}
        level={summary.level.level}
      />

      {onSale.length === 0 && !creating ? (
        <RewardsEmpty onNew={() => onCreatingChange(true)} />
      ) : (
        <RewardsSortable
          aria-label="Rewards"
          items={shown}
          nameOf={(r) => r.title}
          onReorder={(ids) => void reorder(ids)}
          renderRow={(reward, { handle }) => (
            <RewardsCard
              reward={reward}
              balance={summary.balance}
              handle={handle}
              actions={actions}
              onRedeem={(r) => setDialog({ reward: r, open: true })}
            />
          )}
        />
      )}

      {onSale.length > 0 || creating ? (
        <RewardsNewRow open={creating} onOpenChange={onCreatingChange} actions={actions} />
      ) : null}

      <RewardsArchived archived={archived} actions={actions} />

      <RewardsRedeemDialog
        reward={dialog?.reward ?? null}
        open={dialog?.open ?? false}
        balance={summary.balance}
        onClose={() => setDialog((d) => (d ? { ...d, open: false } : d))}
        onConfirm={actions.redeem}
      />
    </div>
  )
}
