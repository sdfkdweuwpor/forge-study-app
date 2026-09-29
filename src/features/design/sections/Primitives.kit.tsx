import type { ReactNode } from 'react'
import styles from './Primitives.demo.module.css'

/** Forced states shown side by side in the Primitives demos (see src/ui/internal/force.ts). */
export const FORCE_STATES = [
  { label: 'Rest', force: undefined },
  { label: 'Hover', force: 'hover' },
  { label: 'Active', force: 'active' },
  { label: 'Focus', force: 'focus' },
] as const

export function Stack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>
}

export function Block({ caption, children }: { caption: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.block}>
      <span className={styles.caption}>{caption}</span>
      {children}
    </div>
  )
}

export function Row({
  children,
  align = 'end',
}: {
  children: ReactNode
  align?: 'end' | 'center' | 'start'
}) {
  return (
    <div className={styles.row} data-align={align}>
      {children}
    </div>
  )
}

/** One specimen with a small label under it ("Hover", "Disabled"). */
export function Cell({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.cell}>
      {children}
      <span className={styles.cellLabel}>{label}</span>
    </div>
  )
}

export { styles as demo }
