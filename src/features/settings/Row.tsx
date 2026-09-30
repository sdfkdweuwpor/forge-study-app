import { useId, type ReactNode } from 'react'
import styles from './settings.module.css'

interface RowProps {
  label: ReactNode
  help?: ReactNode
  /** Receives the id of the label, for `aria-labelledby` on the control. */
  children: (labelId: string) => ReactNode
}

/** One setting: its name and a line of help on the left, the control on the right (below it on a phone). */
export function Row({ label, help, children }: RowProps) {
  const labelId = useId()
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        {help ? <p className={styles.help}>{help}</p> : null}
      </div>
      <div className={styles.control}>{children(labelId)}</div>
    </div>
  )
}
