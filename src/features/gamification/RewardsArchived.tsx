import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { Reward } from '@/db/types'
import { formatPrice } from '@/logic/rewards'
import { Button } from '@/ui/Button'
import type { RewardActions } from './RewardsActions'
import styles from './RewardsArchived.module.css'

interface Props {
  archived: readonly Reward[]
  actions: RewardActions
}

/** Archived rewards, folded away under the shop. Restoring one puts it back where it was. */
export function RewardsArchived({ archived, actions }: Props) {
  const [open, setOpen] = useState(false)
  if (archived.length === 0) return null

  return (
    <section className={styles.root} aria-label="Archived rewards">
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight size={14} className={styles.chevron} aria-hidden="true" />
        Archived ({archived.length})
      </button>
      {open ? (
        <ul className={styles.list}>
          {archived.map((reward) => (
            <li key={reward.id} className={styles.item}>
              <span className={styles.icon} aria-hidden="true">
                {reward.icon}
              </span>
              <span className={styles.title}>{reward.title}</span>
              <span className={styles.price}>{formatPrice(reward.price)}</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Restore ${reward.title}`}
                onClick={() => void actions.restore(reward)}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
