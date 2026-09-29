import { useRef, type ReactNode } from 'react'
import { useShortcutHandler, useShortcutScope } from '../shortcuts'
import styles from './Drawer.module.css'
import { useModalFocus } from './useModalFocus'

interface DrawerProps {
  open: boolean
  onClose: () => void
  /** Accessible name of the dialog. */
  label: string
  side?: 'left' | 'bottom'
  children: ReactNode
}

/**
 * Overlay panel for the tablet sidebar (side="left") and the mobile "More" sheet (side="bottom").
 * Always mounted so it can animate out; `inert` while closed. Escape, the scrim and route changes close it.
 * While open it is a blocking `drawer` shortcut scope, so neither the page's keys (`x`, `j`…) nor global
 * sequences (`g t`…) fire underneath it, and Esc closes it.
 */
export function Drawer({ open, onClose, label, side = 'left', children }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocus(open, panelRef)
  useShortcutScope('drawer', open)
  useShortcutHandler('app.escape', onClose, open)

  return (
    <div className={styles.root} data-open={open || undefined} data-side={side} inert={!open}>
      <button
        type="button"
        className={styles.scrim}
        tabIndex={-1}
        aria-label="Close"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={styles.panel}
      >
        {children}
      </div>
    </div>
  )
}
