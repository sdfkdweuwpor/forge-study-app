import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useMediaQuery } from '@/app/hooks/useMediaQuery'
import { Button } from '@/ui/Button'
import { Kbd } from '@/ui/Kbd'
import { focusWhenShown } from '@/ui/Settle'
import { Skeleton } from '@/ui/Skeleton'
import { ParkedList } from './ParkedList'
import { useOpenParked } from './queries'
import { onParkedReview, takeParkedReview } from './store'
import styles from './TodayCard.module.css'

/**
 * Slot `today.aside`: "Parked thoughts (5)". Everything you set aside during focus that is still waiting,
 * with the same three actions as the end-of-session dialog. Quiet by design: a short line when there is
 * nothing, a list you can fold away when there is. "Review parked thoughts" in the palette lands here.
 */
export function ParkedTodayCard() {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <section className={styles.card} aria-label="Parked thoughts">
          <p className={styles.quiet}>Couldn’t load your parked thoughts. They are safe.</p>
          <Button variant="secondary" size="sm" onClick={reset}>
            Try again
          </Button>
        </section>
      )}
    >
      <ParkedTodayBody />
    </ErrorBoundary>
  )
}

/**
 * The key hint is for a keyboard: a hover-capable pointer on a screen wide enough to have one at hand.
 * A phone or a tablet held by hand has no P key, so there the sentence points at the button instead.
 */
const KEYBOARD_HINT_QUERY = '(hover: hover) and (min-width: 640px)'

function EmptyHint() {
  const keyboard = useMediaQuery(KEYBOARD_HINT_QUERY)
  return (
    <p className={styles.quiet}>
      {keyboard ? (
        <>
          Nothing parked. Press <Kbd keys="p" variant="plain" size="sm" /> during focus to set a
          thought aside for later.
        </>
      ) : (
        'Nothing parked. Park a thought from the Focus page while a session runs.'
      )}
    </p>
  )
}

function ParkedTodayBody() {
  const items = useOpenParked()
  const [open, setOpen] = useState(true)
  const headingId = useId()
  const panelId = useId()
  const toggle = useRef<HTMLButtonElement | null>(null)

  // "Review parked thoughts": open the card, scroll it into view and put keyboard focus on its heading
  // (once the page shows it: it can hold the card hidden while it settles).
  useEffect(() => {
    let cancel = (): void => undefined
    const answer = (): void => {
      if (!takeParkedReview()) return
      setOpen(true)
      const button = toggle.current
      if (button) cancel = focusWhenShown(button, () => button.scrollIntoView({ block: 'center' }))
    }
    answer()
    const off = onParkedReview(answer)
    return () => {
      off()
      cancel()
    }
  }, [])

  const count = items?.length

  return (
    <section
      className={styles.card}
      aria-labelledby={headingId}
      data-testid="parked-card"
      aria-busy={items === undefined || undefined}
    >
      <h2 className={styles.heading} id={headingId}>
        <button
          type="button"
          ref={toggle}
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          <span>Parked thoughts{count === undefined ? '' : ` (${count})`}</span>
        </button>
      </h2>
      <div id={panelId} hidden={!open} className={styles.body}>
        {items === undefined ? (
          <div className={styles.skeleton} aria-hidden="true">
            <Skeleton width="80%" />
            <Skeleton width="55%" />
          </div>
        ) : items.length === 0 ? (
          <EmptyHint />
        ) : (
          <ParkedList items={items} label="Parked thoughts" />
        )}
      </div>
    </section>
  )
}
