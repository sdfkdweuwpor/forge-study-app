import { CalendarPlus, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { recordError } from '@/app/reportError'
import { deleteRoutine, renameRoutine, type RoutineRow } from '@/db/repos/templates'
import { ROUTINE_NAME_MAX, STARTER_ROUTINES, type RoutineEntry } from '@/logic/routines'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/Toast'
import { useRitualActions } from './actions'
import { useRoutineRows } from './queries'
import { routineSummary } from './RoutineMenu'
import { openRitualDialog } from './store'
import styles from './Settings.module.css'

/**
 * Settings → Routines (slot `settings.sections`): the sets of tasks you have saved, and the two starters
 * that are always there. Add one to today, rename it in place, or delete it (with Undo). New ones are saved
 * from today's tasks.
 */
export function RoutinesSection() {
  const headingId = useId()
  const rows = useRoutineRows()
  const today = useToday()
  const toast = useToast()
  const actions = useRitualActions()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // Enter commits and the field then goes away, which may also blur it: commit once.
  const editing = useRef<string | null>(null)
  const renameField = useRef<HTMLInputElement | null>(null)

  // The rename field takes the keyboard as it appears.
  useEffect(() => {
    if (renaming === null) return
    renameField.current?.focus()
    renameField.current?.select()
  }, [renaming])

  function startRename(row: RoutineRow): void {
    editing.current = row.template.id
    setDraft(row.template.name)
    setRenaming(row.template.id)
  }

  function cancelRename(): void {
    editing.current = null
    setRenaming(null)
  }

  async function commitRename(row: RoutineRow): Promise<void> {
    if (editing.current !== row.template.id) return
    editing.current = null
    const name = draft.trim()
    setRenaming(null)
    if (name === '' || name === row.template.name) return
    try {
      const result = await renameRoutine(row.template.id, name)
      if (result) toast.show({ title: `Renamed to “${name}”`, undo: result.undo })
    } catch (error) {
      recordError(error, 'renameRoutine')
      toast.error('Couldn’t rename that routine', { description: 'Nothing was changed.' })
    }
  }

  async function remove(row: RoutineRow): Promise<void> {
    try {
      const result = await deleteRoutine(row.template.id)
      if (result) toast.show({ title: `Deleted “${row.template.name}”`, undo: result.undo })
    } catch (error) {
      recordError(error, 'deleteRoutine')
      toast.error('Couldn’t delete that routine', { description: 'Nothing was changed.' })
    }
  }

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>, row: RoutineRow): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitRename(row)
    } else if (e.key === 'Escape') {
      // Only the rename closes; the page's own Escape stays out of it.
      e.stopPropagation()
      cancelRename()
    }
  }

  const starter = (entry: RoutineEntry) => (
    <li key={entry.id} className={styles.item}>
      <span className={styles.icon} aria-hidden="true">
        {entry.icon}
      </span>
      <div className={styles.itemText}>
        <span className={styles.name}>{entry.name}</span>
        <span className={styles.meta}>Starter · {routineSummary(entry)}</span>
      </div>
      <div className={styles.actions}>
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<CalendarPlus />}
          onClick={() => void actions.apply(entry, today, today)}
          aria-label={`Add ${entry.name} to today`}
        >
          Add to today
        </Button>
      </div>
    </li>
  )

  return (
    <section className={styles.section} aria-labelledby={headingId} data-testid="routines-section">
      <h2 id={headingId} className={styles.heading}>
        Routines
      </h2>
      <p className={styles.intro}>
        A routine is a set of tasks you add to a day in one click. Save today’s tasks as one, or
        start from a starter.
      </p>
      <div className={styles.buttons}>
        <Button variant="secondary" onClick={() => openRitualDialog('saveRoutine')}>
          Save today’s tasks as a routine…
        </Button>
        <Button variant="ghost" onClick={() => openRitualDialog('routine')}>
          Add a routine to a day…
        </Button>
      </div>

      <h3 className={styles.subhead}>Your routines</h3>
      {rows === undefined ? (
        <div className={styles.loading} role="status" aria-label="Loading routines">
          <Skeleton variant="block" height={44} />
          <Skeleton variant="block" height={44} />
        </div>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>
          Nothing saved yet. Add a few tasks to today, then save them as a routine.
        </p>
      ) : (
        <ul className={styles.list} aria-label="Your routines">
          {rows.map((row) => {
            const { template, payload } = row
            const entry: RoutineEntry | null = payload
              ? {
                  id: template.id,
                  name: template.name,
                  icon: template.icon,
                  builtIn: false,
                  payload,
                }
              : null
            return (
              <li key={template.id} className={styles.item} data-testid="routine-row">
                <span className={styles.icon} aria-hidden="true">
                  {template.icon}
                </span>
                {renaming === template.id ? (
                  <Input
                    className={styles.rename}
                    aria-label={`Rename ${template.name}`}
                    value={draft}
                    maxLength={ROUTINE_NAME_MAX}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => onRenameKey(e, row)}
                    onBlur={() => void commitRename(row)}
                    ref={renameField}
                  />
                ) : (
                  <div className={styles.itemText}>
                    <span className={styles.name}>{template.name}</span>
                    <span className={styles.meta}>
                      {entry
                        ? routineSummary(entry)
                        : 'This routine can’t be read. You can delete it.'}
                    </span>
                  </div>
                )}
                <div className={styles.actions}>
                  {entry ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      iconLeft={<CalendarPlus />}
                      onClick={() => void actions.apply(entry, today, today)}
                      aria-label={`Add ${template.name} to today`}
                    >
                      Add to today
                    </Button>
                  ) : null}
                  {entry ? (
                    <IconButton
                      label={`Rename ${template.name}`}
                      icon={<Pencil />}
                      onClick={() => startRename(row)}
                    />
                  ) : null}
                  <IconButton
                    label={`Delete ${template.name}`}
                    icon={<Trash2 />}
                    onClick={() => void remove(row)}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <h3 className={styles.subhead}>Starters</h3>
      <ul className={styles.list} aria-label="Starter routines">
        {STARTER_ROUTINES.map(starter)}
      </ul>
    </section>
  )
}
