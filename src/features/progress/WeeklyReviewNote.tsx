import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { recordError } from '@/app/reportError'
import { saveReviewNote } from '@/db/repos/reviews'
import type { ISODate } from '@/db/types'
import { Textarea } from '@/ui/Textarea'
import styles from './WeeklyReviewPage.module.css'

/** Saving on every keystroke would rewrite the row for nothing; wait for a pause. */
const SAVE_DELAY_MS = 600

type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

const STATUS_TEXT: Record<SaveState, string> = {
  idle: 'Just for you. It saves as you type.',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Couldn’t save that. Your text is still here; try typing again.',
}

/**
 * "What got in the way?": a plain text box, saved to the week's `weeklyReviews` row after a short pause
 * and flushed on blur, when the tab is hidden, when the page is left and when the week changes. It owns
 * its text while it is open (the stored text seeds it once), so a live re-read never overwrites what is
 * being typed. Render it with `key={weekStart}`.
 */
export function WeeklyReviewNote({
  weekStart,
  initial,
}: {
  weekStart: ISODate
  initial: string
}) {
  const headingId = useId()
  const [text, setText] = useState(initial)
  const [state, setState] = useState<SaveState>('idle')
  const pending = useRef<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const mounted = useRef(true)

  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    const unsaved = pending.current
    if (unsaved === null) return
    pending.current = null
    if (mounted.current) setState('saving')
    try {
      await saveReviewNote(weekStart, unsaved)
      if (mounted.current && pending.current === null) setState('saved')
    } catch (error) {
      recordError(error, 'saveWeeklyReviewNote')
      if (mounted.current) setState('failed')
    }
  }, [weekStart])

  useEffect(() => {
    mounted.current = true
    // A hidden tab may never come back, and a page being left will not wait for the timer.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onPageHide = () => void flush()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      mounted.current = false
      void flush()
    }
  }, [flush])

  return (
    <section className={styles.section} aria-labelledby={headingId} data-section="note">
      <h2 className={styles.heading} id={headingId}>
        What got in the way?
      </h2>
      <Textarea
        aria-labelledby={headingId}
        placeholder="A long practice test, a slow Tuesday, a week of travel… anything you want to remember."
        minRows={3}
        maxRows={12}
        maxLength={4000}
        value={text}
        onChange={(e) => {
          const next = e.target.value
          setText(next)
          setState('idle')
          pending.current = next
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS)
        }}
        onBlur={() => void flush()}
      />
      <p
        className={styles.saveState}
        role="status"
        aria-live="polite"
        data-state={state}
        data-testid="review-note-status"
      >
        {STATUS_TEXT[state]}
      </p>
    </section>
  )
}
