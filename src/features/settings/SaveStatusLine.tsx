import type { SaveStatus } from './useSaveSettings'
import styles from './settings.module.css'

/** The live line under a section's rows. Always rendered, so the announcement has somewhere to land. */
export function SaveStatusLine({ status }: { status: SaveStatus | null }) {
  return (
    <p
      className={styles.status}
      role={status?.tone === 'error' ? 'alert' : 'status'}
      data-tone={status?.tone === 'error' ? 'error' : undefined}
    >
      {status?.text ?? ''}
    </p>
  )
}
