import { RotateCcw, Trash2 } from 'lucide-react'
import { daysUntilPurge, purgeLabel } from '@/logic/retention'
import { contentsSummary, deletedLabel, parentsNote, type TrashEntry } from '@/logic/trashList'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'
import styles from './TrashPage.module.css'

/** The DOM id of a row's Restore button (j and k move focus there). */
export const restoreButtonId = (trashId: string): string => `trash-restore-${trashId}`

/** Items with this many days or fewer left are pointed out. */
const SOON_DAYS = 3

interface RowProps {
  entry: TrashEntry
  now: number
  /** The row the keyboard is on. */
  current: boolean
  onFocusRow: (id: string) => void
  onRestore: (entry: TrashEntry) => void
  onDelete: (entry: TrashEntry) => void
}

/** One deleted item: what it is, when it went, when it is deleted for good, and the two things to do with it. */
export function TrashRow({ entry, now, current, onFocusRow, onRestore, onDelete }: RowProps) {
  const inside = contentsSummary(entry.contents)
  const note = parentsNote(entry)
  const soon = daysUntilPurge(entry.expiresAt, now) <= SOON_DAYS
  return (
    <li
      className={styles.row}
      data-current={current || undefined}
      data-trash-id={entry.id}
      onFocus={() => onFocusRow(entry.id)}
    >
      <div className={styles.text}>
        <span className={styles.title} title={entry.title}>
          {entry.title}
        </span>
        <span className={styles.meta}>
          {deletedLabel(entry.deletedAt, now)}
          <span className={styles.dot} aria-hidden="true">
            ·
          </span>
          <span className={soon ? styles.soon : undefined}>{purgeLabel(entry.expiresAt, now)}</span>
        </span>
        {inside ? <span className={styles.detail}>Includes {inside}</span> : null}
        {note ? (
          <span className={styles.note} data-blocked={!entry.restorable || undefined}>
            {note}
          </span>
        ) : null}
      </div>
      <div className={styles.actions}>
        <Button
          id={restoreButtonId(entry.id)}
          size="sm"
          iconLeft={<RotateCcw />}
          disabled={!entry.restorable}
          aria-label={`Restore “${entry.title}”`}
          onClick={() => onRestore(entry)}
        >
          Restore
        </Button>
        <IconButton
          className={styles.delete}
          label={`Delete “${entry.title}” forever`}
          icon={<Trash2 />}
          onClick={() => onDelete(entry)}
        />
      </div>
    </li>
  )
}
