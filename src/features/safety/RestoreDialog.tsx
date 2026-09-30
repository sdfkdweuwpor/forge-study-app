import { useState } from 'react'
import { formatBytes, snapshotContents, snapshotKindLabel, whenLabel } from '@/logic/retention'
import type { SnapshotInfo } from '@/db/repos/snapshots'
import { Button } from '@/ui/Button'
import { Modal } from '@/ui/Modal'
import styles from './Snapshots.module.css'

interface Props {
  snapshot: SnapshotInfo | null
  now: number
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** The confirmation in front of a restore: what will be replaced, with what, and how to go back. */
export function RestoreDialog({ snapshot: asked, now, busy, error, onCancel, onConfirm }: Props) {
  // The last snapshot asked about stays in the dialog while it fades out.
  const [kept, setKept] = useState(asked)
  if (asked && asked !== kept) setKept(asked)
  const snapshot = asked ?? kept
  const inside = snapshot ? snapshotContents(snapshot.counts) : ''
  return (
    <Modal
      open={asked !== null}
      onClose={onCancel}
      title="Restore this snapshot?"
      size="sm"
      phoneLayout="sheet"
      description="Everything on this device is replaced with the copy below: tasks, goals, sessions, rewards and settings. Anything you’ve done since is left out."
      closeOnEsc={!busy}
      closeOnScrim={!busy}
      showClose={!busy}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            Restore snapshot
          </Button>
        </>
      }
    >
      <div className={styles.dialog}>
        {snapshot ? (
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt className={styles.factLabel}>Taken</dt>
              <dd className={styles.factValue}>{whenLabel(snapshot.createdAt, now)}</dd>
            </div>
            <div className={styles.fact}>
              <dt className={styles.factLabel}>Kind</dt>
              <dd className={styles.factValue}>{snapshotKindLabel(snapshot.reason)}</dd>
            </div>
            {inside ? (
              <div className={styles.fact}>
                <dt className={styles.factLabel}>Holds</dt>
                <dd className={styles.factValue}>{inside}</dd>
              </div>
            ) : null}
            <div className={styles.fact}>
              <dt className={styles.factLabel}>Size</dt>
              <dd className={styles.factValue}>{formatBytes(snapshot.sizeBytes)}</dd>
            </div>
          </dl>
        ) : null}
        <p className={styles.note}>
          Forge first saves your current data as a “Before restore” snapshot, so you can undo this.
          Attached PDFs aren’t part of a snapshot: the ones on this device, including any in the
          Trash, stay as they are.
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
