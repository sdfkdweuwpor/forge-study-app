import { useState } from 'react'
import {
  EMPTY_TRASH_PHRASE,
  contentsSummary,
  isEmptyTrashPhrase,
  itemCount,
  typeLabel,
} from '@/logic/trashList'
import type { TrashEntry } from '@/logic/trashList'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { Modal } from '@/ui/Modal'
import styles from './TrashPage.module.css'

interface DeleteProps {
  entry: TrashEntry | null
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** "Delete forever" for one entry. It cannot be undone, so it asks; Cancel has the focus. */
export function DeleteForeverDialog({
  entry: asked,
  busy,
  error,
  onCancel,
  onConfirm,
}: DeleteProps) {
  // The last entry asked about stays in the dialog while it fades out.
  const [kept, setKept] = useState(asked)
  if (asked && asked !== kept) setKept(asked)
  const entry = asked ?? kept
  const inside = entry ? contentsSummary(entry.contents) : ''
  return (
    <Modal
      open={asked !== null}
      onClose={onCancel}
      title={entry ? `Delete “${entry.title}” forever?` : 'Delete forever?'}
      size="sm"
      phoneLayout="sheet"
      description={
        entry
          ? `This ${typeLabel(entry.table).toLowerCase()}${inside ? `, with its ${inside},` : ''} will be permanently deleted. It can’t be undone.`
          : undefined
      }
      closeOnEsc={!busy}
      closeOnScrim={!busy}
      showClose={!busy}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            Delete forever
          </Button>
        </>
      }
    >
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : (
        <p className={styles.hint}>
          If you might need it, restore it instead. Items leave the Trash by themselves after 30
          days.
        </p>
      )}
    </Modal>
  )
}

interface EmptyProps {
  open: boolean
  count: number
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** "Empty trash": the typed confirmation, because everything in it goes at once. */
export function EmptyTrashDialog({ open, count, busy, error, onCancel, onConfirm }: EmptyProps) {
  const [typed, setTyped] = useState('')
  const [wasOpen, setWasOpen] = useState(open)
  // Whatever closes the dialog (Cancel, Esc, Back, success), the next opening starts with an empty field.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setTyped('')
  }
  const ready = isEmptyTrashPhrase(typed)

  function close() {
    setTyped('')
    onCancel()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Empty the Trash?"
      size="sm"
      phoneLayout="sheet"
      description={`This permanently deletes ${itemCount(count)}, with everything inside them. It can’t be undone.`}
      closeOnEsc={!busy}
      closeOnScrim={!busy}
      showClose={!busy}
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!ready} loading={busy} onClick={onConfirm}>
            {`Delete ${itemCount(count)}`}
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
        <Input
          label={`Type “${EMPTY_TRASH_PHRASE}” to confirm`}
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
