import { useState } from 'react'
import type { Reward } from '@/db/types'
import { formatPrice, formatXpNumber } from '@/logic/rewards'
import { Button } from '@/ui/Button'
import { Modal } from '@/ui/Modal'
import styles from './RewardsRedeemDialog.module.css'

interface Props {
  /** The reward being confirmed; keep passing it while the dialog closes so the text does not vanish mid-fade. */
  reward: Reward | null
  open: boolean
  /** Spendable XP right now. */
  balance: number
  onClose: () => void
  /** Buys it. The dialog closes when this settles. */
  onConfirm: (reward: Reward) => Promise<unknown>
}

/** "Redeem 30 min gaming for 300 XP?" A plain yes/no: what you will have left, and that Undo is right there. */
export function RewardsRedeemDialog({ reward, open, balance, onClose, onConfirm }: Props) {
  const [busy, setBusy] = useState(false)

  async function confirm() {
    if (!reward || busy) return
    setBusy(true)
    try {
      await onConfirm(reward)
    } finally {
      setBusy(false)
      onClose()
    }
  }

  const price = reward?.price ?? 0
  return (
    <Modal
      open={open && reward !== null}
      onClose={onClose}
      size="sm"
      title={reward ? `Redeem ${reward.title} for ${formatPrice(price)}?` : 'Redeem reward'}
      description={`You have ${formatXpNumber(balance)} XP, so ${formatXpNumber(Math.max(0, balance - price))} XP will be left. You can undo it right after.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} data-autofocus="" onClick={() => void confirm()}>
            Redeem
          </Button>
        </>
      }
    >
      {reward ? <RewardPreview reward={reward} /> : null}
    </Modal>
  )
}

function RewardPreview({ reward }: { reward: Reward }) {
  return (
    <div className={styles.preview}>
      <span className={styles.icon} aria-hidden="true">
        {reward.icon}
      </span>
      <span className={styles.text}>
        <span className={styles.title}>{reward.title}</span>
        <span className={styles.price}>{formatPrice(reward.price)}</span>
      </span>
    </div>
  )
}
