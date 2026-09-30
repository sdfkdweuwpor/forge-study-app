import { RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SyncStateView } from '@/db/hooks/useSyncState'
import { clockWarning, progressText } from '@/logic/syncStatus'
import { Button } from '@/ui/Button'
import { Modal } from '@/ui/Modal'
import { Spinner } from '@/ui/Spinner'
import { useToast } from '@/ui/Toast'
import { startEngine } from './engine'
import { CopySqlButton } from './SetupForm'
import { SignIn } from './SignIn'
import { useSyncStatus } from './status'
import styles from './SyncSection.module.css'

const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

/** Bringing this device together with the cloud copy: a quiet count, and the promise that nothing is lost. */
function FirstSync({ view }: { view: SyncStateView }) {
  const { engine } = useSyncStatus(view)
  return (
    <div className={styles.step}>
      <h3 className={styles.title}>Bringing this device together with your cloud copy…</h3>
      <p className={styles.lead}>
        Nothing is deleted: where both have a change, the newer one is kept. A snapshot was taken
        first.
      </p>
      <p className={styles.progress} aria-busy="true">
        <Spinner size={16} />
        <span>{progressText(engine.progress)}</span>
      </p>
    </div>
  )
}

/** "Sign out and stop syncing", behind a small confirmation with Cancel focused. */
function SignOutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const { signOutAndStop } = await import('./actions')
      const result = await signOutAndStop()
      if (result.ok) {
        onClose()
        toast.show({
          title: 'Sync is off on this device',
          description: 'Everything is still here, and your cloud copy is untouched.',
        })
      } else setError(result.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sign out and stop syncing?"
      size="sm"
      phoneLayout="sheet"
      description="Forge stops syncing on this device. Everything stays on this device, and your cloud copy stays in your Supabase project."
      closeOnEsc={!busy}
      closeOnScrim={!busy}
      showClose={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} data-autofocus>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void confirm()}>
            Sign out and stop syncing
          </Button>
        </>
      }
    >
      {error !== null ? (
        <p className={styles.notice} data-tone="attention" role="alert">
          {error}
        </p>
      ) : (
        <p className={styles.help}>You can turn sync on again later. That is a new first sync.</p>
      )}
    </Modal>
  )
}

/** On: how it is going, what to do about it when it needs you, and the way out. */
function On({ view }: { view: SyncStateView }) {
  const { line, engine } = useSyncStatus(view)
  const [signingOut, setSigningOut] = useState(false)
  const warning = clockWarning(view.clockSkewMs)

  return (
    <div className={styles.body}>
      <div className={styles.statusRow}>
        <span className={styles.dot} data-tone={line.tone} aria-hidden="true" />
        <p className={styles.status} role="status" aria-live="polite">
          <span>{line.lead}</span>
          {line.tail !== '' ? (
            <span className={styles.tail} aria-hidden="true">
              {line.tail}
            </span>
          ) : null}
        </p>
      </div>

      {line.need === 'signIn' ? <SignIn view={view} again /> : null}

      <div className={styles.actions}>
        {line.need === 'setup' || line.need === 'forbidden' ? <CopySqlButton /> : null}
        {line.need === 'update' ? (
          <Button variant="primary" iconLeft={<RotateCw />} onClick={() => window.location.reload()}>
            Reload
          </Button>
        ) : null}
        {line.need !== 'signIn' && line.need !== 'update' ? (
          <Button
            variant={line.need === null ? 'secondary' : 'primary'}
            iconLeft={<RotateCw />}
            loading={engine.running}
            onClick={() => startEngine().syncNow()}
          >
            Sync now
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => setSigningOut(true)}>
          Sign out and stop syncing
        </Button>
      </div>

      <dl className={styles.facts}>
        <dt>Account</dt>
        <dd>{view.email ?? 'Signed out'}</dd>
        <dt>This device last synced</dt>
        <dd>{view.lastSyncAt === null ? 'Not yet' : dateTime.format(view.lastSyncAt)}</dd>
      </dl>
      {warning !== null ? (
        <p className={styles.notice} data-tone="attention">
          {warning}
        </p>
      ) : null}

      <SignOutDialog open={signingOut} onClose={() => setSigningOut(false)} />
    </div>
  )
}

/**
 * What the section shows while sync is on (and lazy, so a person who never turns it on never loads it):
 * the first sync's progress, then the status line with its controls. It also makes sure this tab has an
 * engine, which a tab opened before sync was turned on (in another tab) does not have yet.
 */
export function SyncStatus({ view }: { view: SyncStateView }) {
  useEffect(() => {
    startEngine()
  }, [])
  return view.phase !== 'steady' && view.signedIn ? <FirstSync view={view} /> : <On view={view} />
}
