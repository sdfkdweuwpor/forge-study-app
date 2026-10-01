import { Flag } from 'lucide-react'
import type { Priority } from '@/db/types'
import { priorityLabel } from './priority'
import styles from './PriorityFlag.module.css'

/**
 * The priority flag: coloured by level (urgent and high stand out, medium is the accent, low is quiet)
 * and filled from high up. The colour is never the only signal: the level is in the accessible name.
 */
export function PriorityFlag({ priority, size = 14 }: { priority: Priority; size?: number }) {
  return (
    <span
      className={styles.flag}
      data-priority={priority}
      role="img"
      aria-label={`Priority: ${priorityLabel(priority)}`}
    >
      <Flag size={size} strokeWidth={1.9} aria-hidden="true" />
    </span>
  )
}
