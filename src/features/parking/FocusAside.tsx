import { CircleParking } from 'lucide-react'
import { useTimer } from '@/features/focus'
import { Button } from '@/ui/Button'
import { Kbd } from '@/ui/Kbd'
import { useParkedInSession } from './queries'
import { openParking } from './store'
import styles from './FocusAside.module.css'

/**
 * Slot `focus.aside`: a button for what `p` does, for anyone without a keyboard at hand, and a quiet line
 * about what this session has collected so far.
 */
export function FocusParking() {
  const timer = useTimer()
  const sessionId = timer.session?.kind === 'focus' ? timer.session.id : null
  return (
    <div className={styles.root}>
      <span className={styles.label}>Distractions</span>
      <Button
        size="sm"
        iconLeft={<CircleParking />}
        aria-keyshortcuts="P"
        data-testid="park-open"
        onClick={openParking}
      >
        Park a thought
        <Kbd keys="p" variant="plain" size="sm" className={styles.key} aria-hidden="true" />
      </Button>
      {sessionId === null ? (
        <p className={styles.hint}>An urge to check something? Set it aside and keep going.</p>
      ) : (
        <SessionCount sessionId={sessionId} />
      )}
    </div>
  )
}

function SessionCount({ sessionId }: { sessionId: string }) {
  const items = useParkedInSession(sessionId)
  const count = items?.length ?? 0
  return (
    <p className={styles.hint} aria-live="polite">
      {count === 0
        ? 'An urge to check something? Set it aside and keep going.'
        : `${count} parked this session. They’ll be waiting when you’re done.`}
    </p>
  )
}
