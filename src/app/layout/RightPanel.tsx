import { Slot, useSlotCount } from '../registry'
import styles from './RightPanel.module.css'

/** Optional right column (desktop only), e.g. the timer. Renders nothing while the slot is empty. */
export function RightPanel() {
  const count = useSlotCount('shell.rightPanel')
  if (count === 0) return null
  return (
    <aside aria-label="Details" className={styles.panel}>
      <Slot id="shell.rightPanel" />
    </aside>
  )
}
