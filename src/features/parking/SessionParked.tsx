import { ChevronDown, ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import type { ID } from '@/db/types'
import { ParkedList } from './ParkedList'
import { useParkedInSession } from './queries'
import styles from './SessionParked.module.css'

/**
 * Slot `focus.afterSession`: "Parked during this session (3)", a compact, collapsible list in the end
 * dialog. It is an invitation, not a screen: nothing shows while it loads, when nothing was parked, or
 * if reading fails (a quiet line says so). When every thought has been sorted it says that, once.
 */
export function SessionParked({ sessionId }: { sessionId: ID }) {
  return (
    <ErrorBoundary
      fallback={() => <p className={styles.quiet}>Couldn’t load what you parked. It is safe.</p>}
    >
      <SessionParkedBody sessionId={sessionId} />
    </ErrorBoundary>
  )
}

function SessionParkedBody({ sessionId }: { sessionId: ID }) {
  const all = useParkedInSession(sessionId)
  const [open, setOpen] = useState(true)
  // Whether there was ever something to sort, so the last one leaving is met with a word, not a gap.
  const [hadOpen, setHadOpen] = useState(false)
  const panelId = useId()

  const items = (all ?? []).filter((i) => i.status === 'open')
  const sorted = all !== undefined && all.length > 0 && items.length === 0
  if (items.length > 0 && !hadOpen) setHadOpen(true)

  if (all === undefined || all.length === 0) return null
  if (sorted) {
    return hadOpen ? (
      <p className={styles.quiet} role="status">
        Everything you parked is sorted.
      </p>
    ) : null
  }

  return (
    <section className={styles.section} aria-label="Parked during this session">
      <h3 className={styles.heading}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          <span>Parked during this session ({items.length})</span>
        </button>
      </h3>
      <div id={panelId} hidden={!open}>
        <p className={styles.lede}>Nothing to do about these right now. Sort them when you like.</p>
        <ParkedList items={items} label="Parked during this session" />
      </div>
    </section>
  )
}
