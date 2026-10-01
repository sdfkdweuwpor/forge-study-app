import { Download } from 'lucide-react'
import { useState } from 'react'
import { useSyncOn } from '@/db/hooks/useSyncState'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { Modal } from '@/ui/Modal'
import { RESET_PHRASE, isResetPhrase } from '@/logic/backup'
import styles from './data.module.css'
import { useBackupExport } from './useBackupExport'

interface ResetDialogProps {
  open: boolean
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** The typed confirmation in front of Reset: the button stays off until the words are right. */
export function ResetDialog({ open, busy, error, onCancel, onConfirm }: ResetDialogProps) {
  const [typed, setTyped] = useState('')
  const exporter = useBackupExport()
  const syncOn = useSyncOn()
  const ready = isResetPhrase(typed)

  function close() {
    setTyped('')
    onCancel()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Reset Forge?"
      size="sm"
      phoneLayout="sheet"
      description="This erases every task, goal, session, reward and setting on this device, then starts you from the welcome tour. It can’t be undone from here."
      closeOnEsc={!busy}
      closeOnScrim={!busy}
      showClose={!busy}
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!ready} loading={busy} onClick={onConfirm}>
            Reset everything
          </Button>
        </>
      }
    >
      <form
        className={styles.dialog}
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !busy) onConfirm()
        }}
      >
        <p className={styles.safety}>
          Forge keeps a snapshot of your data inside the app first, but a file on your device is
          safer.
        </p>
        {syncOn ? (
          <p className={styles.safety}>
            Sync will be turned off on this device. Your other devices and the cloud copy keep their
            data.
          </p>
        ) : null}
        <div>
          <Button
            size="sm"
            iconLeft={<Download />}
            loading={exporter.busy}
            onClick={() => void exporter.run()}
          >
            Export a backup first
          </Button>
        </div>
        <Input
          label={`Type “${RESET_PHRASE}” to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          data-autofocus
          disabled={busy}
        />
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
