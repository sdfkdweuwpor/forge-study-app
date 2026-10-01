/**
 * Settings → Snapshots (slot `settings.sections`, id `safety.snapshots`): the copies of your data Forge keeps
 * inside this browser. A list (date, kind, size, what is in it), Restore behind a confirmation, Download as
 * JSON, and "Take snapshot now". Loading, empty and error each have their own view; a read that fails is
 * caught by the page's section boundary, which offers to try again.
 */
import { Camera, Download } from 'lucide-react'
import { useId, useState } from 'react'
import { useNow } from '@/app/hooks/useNow'
import type { SnapshotInfo } from '@/db/repos/snapshots'
import {
  SNAPSHOT_KEEP,
  formatBytes,
  snapshotContents,
  snapshotKindLabel,
  whenLabel,
} from '@/logic/retention'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/Toast'
import { downloadSnapshot, restoreAndReload, snapshotNow } from './actions'
import { useSnapshots } from './queries'
import { RestoreDialog } from './RestoreDialog'
import styles from './Snapshots.module.css'

export function SnapshotsSection() {
  const headingId = useId()
  const snapshots = useSnapshots()
  const now = useNow('minute')
  const toast = useToast()
  const [taking, setTaking] = useState(false)
  const [restoring, setRestoring] = useState<SnapshotInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function takeNow() {
    setTaking(true)
    const out = await snapshotNow()
    setTaking(false)
    if (out.ok) {
      toast.success('Snapshot saved', {
        description: `${formatBytes(out.info.sizeBytes)} · kept with your last ${SNAPSHOT_KEEP.manual} manual snapshots.`,
      })
    } else {
      toast.error('Snapshot failed', { description: out.message })
    }
  }

  async function download(info: SnapshotInfo) {
    const out = await downloadSnapshot(info)
    if (!out.ok) toast.error('Couldn’t download the snapshot', { description: out.message })
  }

  async function confirmRestore() {
    if (!restoring) return
    setBusy(true)
    setFailure(null)
    // On success the page reloads; only a failure comes back here, and it changed nothing.
    const out = await restoreAndReload(restoring.id, restoring.createdAt)
    if (!out.ok) {
      setBusy(false)
      setFailure(out.message)
    }
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Snapshots
      </h2>
      <p className={styles.intro}>
        Forge saves a copy of your data inside this browser once a day and keeps the last{' '}
        {SNAPSHOT_KEEP.daily}. Restoring one replaces what is on this device. Attached PDFs aren’t
        part of a snapshot, and restoring one never removes them.
      </p>

      <div className={styles.row}>
        <div className={styles.text}>
          <span className={styles.label}>Take a snapshot now</span>
          <p className={styles.help}>
            Saves a copy right away, for example before a big change. The last{' '}
            {SNAPSHOT_KEEP.manual} manual snapshots are kept.
          </p>
        </div>
        <div className={styles.control}>
          <Button iconLeft={<Camera />} loading={taking} onClick={() => void takeNow()}>
            Take snapshot now
          </Button>
        </div>
      </div>

      {snapshots === undefined ? (
        <div
          className={styles.loading}
          role="status"
          aria-busy="true"
          aria-label="Loading snapshots"
        >
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="block" height={44} />
          ))}
        </div>
      ) : snapshots.length === 0 ? (
        <p className={styles.empty}>
          No snapshots yet. Forge takes one automatically the first time you open it each day, once
          there is something to save.
        </p>
      ) : (
        <ul className={styles.list} aria-label="Snapshots">
          {snapshots.map((s) => {
            const when = whenLabel(s.createdAt, now)
            const inside = snapshotContents(s.counts)
            return (
              <li key={s.id} className={styles.item}>
                <div className={styles.text}>
                  <span className={styles.when}>{when}</span>
                  <p className={styles.meta}>
                    {snapshotKindLabel(s.reason)}
                    <span className={styles.dot} aria-hidden="true">
                      ·
                    </span>
                    {formatBytes(s.sizeBytes)}
                    {inside ? (
                      <>
                        <span className={styles.dot} aria-hidden="true">
                          ·
                        </span>
                        {inside}
                      </>
                    ) : null}
                  </p>
                </div>
                <div className={styles.actions}>
                  <Button
                    size="sm"
                    aria-label={`Restore the snapshot from ${when}`}
                    onClick={() => {
                      setFailure(null)
                      setRestoring(s)
                    }}
                  >
                    Restore
                  </Button>
                  <IconButton
                    label={`Download the snapshot from ${when}`}
                    icon={<Download />}
                    onClick={() => void download(s)}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <RestoreDialog
        snapshot={restoring}
        now={now}
        busy={busy}
        error={failure}
        onCancel={() => setRestoring(null)}
        onConfirm={() => void confirmRestore()}
      />
    </section>
  )
}
