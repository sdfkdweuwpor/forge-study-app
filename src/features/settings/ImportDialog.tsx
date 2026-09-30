import { useMemo } from 'react'
import { BACKUP_CONTEXT } from '@/db/repos/backup'
import { summarizeBackup, type BackupFile } from '@/logic/backup'
import { Button } from '@/ui/Button'
import { Modal } from '@/ui/Modal'
import styles from './data.module.css'
import { tableLabel } from './tableLabels'

interface ImportDialogProps {
  open: boolean
  fileName: string
  file: BackupFile
  warnings: string[]
  busy: boolean
  /** Why the last attempt failed; the data is unchanged when this is set. */
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

/** What is inside the chosen backup, and the one button that replaces everything with it. */
export function ImportDialog({
  open,
  fileName,
  file,
  warnings,
  busy,
  error,
  onCancel,
  onConfirm,
}: ImportDialogProps) {
  const summary = useMemo(() => summarizeBackup(file, BACKUP_CONTEXT), [file])
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Import this backup?"
      phoneLayout="sheet"
      description={`${fileName} · exported ${dateTime.format(summary.exportedAt)}`}
      closeOnEsc={!busy}
      closeOnScrim={!busy}
      showClose={!busy}
      footer={
        <>
          {/* Focus starts on the safe choice: Enter must not replace anything. */}
          <Button onClick={onCancel} disabled={busy} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>
            Replace my data
          </Button>
        </>
      }
    >
      <div className={styles.dialog}>
        <p className={styles.lead}>
          <strong>{summary.items.toLocaleString('en-US')} items</strong> from Forge{' '}
          {summary.appVersion} (data version {summary.schemaVersion}).
        </p>
        <ul className={styles.counts} aria-label="What the backup contains">
          {summary.counts.map((c) => (
            <li key={c.table} className={styles.count}>
              <span className={styles.countLabel}>{tableLabel(c.table)}</span>
              <span className={styles.countValue}>{c.count.toLocaleString('en-US')}</span>
            </li>
          ))}
        </ul>
        {summary.needsUpgrade ? (
          <p className={styles.note}>
            This backup is from an older version. Forge upgrades it while importing.
          </p>
        ) : null}
        {[...warnings, ...file.notes].map((text) => (
          <p key={text} className={styles.note}>
            {text}
          </p>
        ))}
        <p className={styles.safety}>
          Importing <strong>replaces everything</strong> on this device. Before it does, Forge
          downloads your current data as a file and keeps a snapshot inside the app.
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            Nothing was changed. {error}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
