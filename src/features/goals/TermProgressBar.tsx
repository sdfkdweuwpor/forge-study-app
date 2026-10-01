import type { TermProgress } from '@/logic/goalDisplay'
import { plural } from '@/logic/goalDisplay'
import { ProgressBar } from '@/ui/ProgressBar'
import styles from './TermProgressBar.module.css'

/** "CUs completed this term" (BRIEF §5.4): CUs of finished courses over the term's planned CUs. */
export function TermProgressBar({ progress }: { progress: TermProgress }) {
  const { term, done, total, daysLeft } = progress
  const timeLeft =
    daysLeft < 0 ? 'ended' : daysLeft === 0 ? 'ends today' : `${plural(daysLeft, 'day')} left`
  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <h3 className={styles.title}>CUs completed this term</h3>
        <span className={styles.value}>
          {done} of {total} CUs
        </span>
      </div>
      <ProgressBar
        value={done}
        max={Math.max(total, 1)}
        size="md"
        label="CUs completed this term"
        valueText={`${done} of ${total} competency units`}
      />
      <p className={styles.caption}>
        {term.label} · {timeLeft}
      </p>
    </div>
  )
}
