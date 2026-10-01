import { formatXpNumber } from '@/logic/rewards'
import styles from './RewardsBalance.module.css'

interface Props {
  /** Spendable XP: lifetime minus what was spent. */
  balance: number
  /** Everything ever earned; levels are computed from this. */
  lifetime: number
  level: number
}

/**
 * The top of the shop: what you can spend, in gold, and what you have earned in all, muted. Both are
 * tabular so the digits do not jitter when a purchase or an Undo changes them.
 */
export function RewardsBalance({ balance, lifetime, level }: Props) {
  return (
    <section className={styles.balance} aria-label="Your XP">
      <div className={styles.main}>
        <span className={styles.caption}>To spend</span>
        <p className={styles.amount} data-testid="rewards-balance">
          {formatXpNumber(balance)}
          <span className={styles.unit}> XP</span>
        </p>
      </div>
      <p className={styles.lifetime} data-testid="rewards-lifetime">
        {formatXpNumber(lifetime)} XP earned in all · Level {level}
        <span className={styles.note}>Spending never lowers your level.</span>
      </p>
    </section>
  )
}
