import { PopoverPanel } from '../Popover/PopoverPanel'
import type { ForceState } from '../internal/force'
import { MenuItems, type MenuEntry } from './MenuItems'
import styles from './Dropdown.module.css'

interface MenuPanelProps {
  entries: readonly MenuEntry[]
  /** Accessible name. */
  label: string
  forceId?: string
  forceState?: ForceState
  emptyLabel?: string
}

/** An open menu drawn in normal flow (no trigger, no positioning). For /design specimens. */
export function MenuPanel({ entries, label, forceId, forceState, emptyLabel }: MenuPanelProps) {
  return (
    <PopoverPanel inline role="menu" aria-label={label} className={styles.menu}>
      <MenuItems
        entries={entries}
        forceId={forceId}
        forceState={forceState}
        emptyLabel={emptyLabel}
      />
    </PopoverPanel>
  )
}
