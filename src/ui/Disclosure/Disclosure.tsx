import { ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import styles from './Disclosure.module.css'

export interface DisclosureProps {
  title: string
  /** Controlled: the caller can open it (for example when copying failed and the text must be shown). */
  open?: boolean
  onToggle?(open: boolean): void
  /** A one-line state shown beside the title, also while closed ("Rain 40% · Campfire 25%"). */
  summary?: ReactNode
  /** Draws a hairline above, for a section at the foot of a panel. */
  ruled?: boolean
  children?: ReactNode
}

/** A native <details> with a quiet chevron and hover wash: keyboard and screen-reader support for free. */
export function Disclosure({ title, open, onToggle, summary, ruled, children }: DisclosureProps) {
  const [own, setOwn] = useState(open ?? false)
  const expanded = open ?? own
  return (
    <details
      className={styles.details}
      data-ruled={ruled || undefined}
      data-wide={summary ? '' : undefined}
      open={open}
      onToggle={(e) => {
        setOwn(e.currentTarget.open)
        onToggle?.(e.currentTarget.open)
      }}
    >
      <summary className={styles.summary} aria-expanded={expanded}>
        <ChevronRight size={14} aria-hidden="true" className={styles.chevron} />
        <span className={styles.title}>{title}</span>
        {summary ? <span className={styles.summaryText}>{summary}</span> : null}
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  )
}
