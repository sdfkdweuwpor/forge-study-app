import type { ReactNode } from 'react'
import { isMac } from '@/lib/platform'
import { ariaKeyShortcuts, Kbd } from '../Kbd'
import type { ForceState } from '../internal/force'
import styles from './Dropdown.module.css'

/** An actionable row. */
export interface MenuItem {
  type?: 'item'
  /** Stable key; also what `forceId` matches. */
  id: string
  label: string
  /** A lucide icon element, e.g. `<Pencil />`. Sized by the menu. */
  icon?: ReactNode
  /** Shortcut spec shown as a hint, e.g. 'mod+k' or 'e'. Display only: the app binds the key. */
  shortcut?: string
  /** Destructive action: red text. Put these last, after a separator. */
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export interface MenuSeparator {
  type: 'separator'
  id?: string
}

/** A quiet, non-interactive group heading. */
export interface MenuLabel {
  type: 'label'
  label: string
}

export type MenuEntry = MenuItem | MenuSeparator | MenuLabel

export function isMenuItem(entry: MenuEntry): entry is MenuItem {
  return entry.type === undefined || entry.type === 'item'
}

interface MenuItemsProps {
  entries: readonly MenuEntry[]
  /** Called when an enabled item is chosen (click, Enter, Space). */
  onChoose?: (item: MenuItem) => void
  /** /design specimens: draw this item in a forced state. */
  forceId?: string
  forceState?: ForceState
  /** Text when there are no items. */
  emptyLabel?: string
}

/** The rows of a menu. Focus is real DOM focus (roving); Dropdown drives it from the keyboard. */
export function MenuItems({
  entries,
  onChoose,
  forceId,
  forceState = 'hover',
  emptyLabel = 'No actions',
}: MenuItemsProps) {
  if (!entries.some(isMenuItem)) {
    return (
      <div className={styles.empty} role="presentation">
        {emptyLabel}
      </div>
    )
  }
  const mac = isMac()
  return entries.map((entry, index) => {
    if (entry.type === 'separator') {
      return <div key={entry.id ?? `sep-${index}`} role="separator" className={styles.separator} />
    }
    if (entry.type === 'label') {
      return (
        <div key={`label-${index}`} role="presentation" className={styles.heading}>
          {entry.label}
        </div>
      )
    }
    return (
      <button
        key={entry.id}
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={styles.item}
        data-label={entry.label}
        aria-label={entry.shortcut ? entry.label : undefined}
        data-danger={entry.danger || undefined}
        data-force={entry.id === forceId ? forceState : undefined}
        aria-disabled={entry.disabled || undefined}
        aria-keyshortcuts={entry.shortcut ? ariaKeyShortcuts(entry.shortcut, mac) : undefined}
        onClick={() => {
          if (!entry.disabled) onChoose?.(entry)
        }}
      >
        <span className={styles.icon} aria-hidden="true">
          {entry.icon}
        </span>
        <span className={styles.label}>{entry.label}</span>
        {entry.shortcut && (
          <Kbd keys={entry.shortcut} variant="plain" size="sm" className={styles.shortcut} />
        )}
      </button>
    )
  })
}
