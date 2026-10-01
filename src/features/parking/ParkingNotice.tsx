import { Check } from 'lucide-react'
import { createPortal } from 'react-dom'
import styles from './ParkingNotice.module.css'

/** "Parked." A quiet confirmation where the popover was, so a thought never disappears without a word. */
export function ParkingNotice({ host }: { host: HTMLElement }) {
  return createPortal(
    <div className={styles.layer}>
      <p className={styles.notice} role="status" data-motion="opacity" data-testid="parking-notice">
        <Check aria-hidden="true" />
        <span>Parked. It’ll be waiting when you’re done.</span>
      </p>
    </div>,
    host,
  )
}
