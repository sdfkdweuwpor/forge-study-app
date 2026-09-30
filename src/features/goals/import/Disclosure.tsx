import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './Disclosure.module.css'

export interface DisclosureProps {
  title: string
  /** Controlled: the caller can open it (for example when copying failed and the text must be shown). */
  open?: boolean
  onToggle?(open: boolean): void
  /** Draws a hairline above, for a section at the foot of a panel. */
  ruled?: boolean
  children: ReactNode
}

/** A native <details> with a quiet chevron and hover wash: keyboard and screen-reader support for free. */
export function Disclosure({ title, open, onToggle, ruled, children }: DisclosureProps) {
  return (
    <details
      className={styles.details}
      data-ruled={ruled || undefined}
      open={open}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
    >
      <summary className={styles.summary}>
        <ChevronRight size={14} aria-hidden="true" className={styles.chevron} />
        {title}
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  )
}
