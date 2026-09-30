import { useMemo, useState, type FormEvent } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { recordError } from '@/app/reportError'
import { createRoutine } from '@/db/repos/templates'
import type { ID } from '@/db/types'
import { addDays } from '@/logic/dates'
import {
  ROUTINE_NAME_MAX,
  ROUTINE_TASKS_MAX,
  routinePayloadFromTasks,
  type RoutineEntry,
} from '@/logic/routines'
import { durationText } from '@/logic/statsLabels'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/Checkbox'
import { DatePicker } from '@/ui/DatePicker'
import { Input } from '@/ui/Input'
import { Modal } from '@/ui/Modal'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/Toast'
import { useRitualActions } from './actions'
import { useRoutineEntries, useTodayLists } from './queries'
import { routineSummary } from './RoutineMenu'
import { useDialogLifecycle } from './useDialog'
import dialog from './Dialog.module.css'
import styles from './Routines.module.css'

type When = 'today' | 'tomorrow' | 'date'

/** "Read the next unit, Practice questions and 2 more" for a routine's preview line. */
function previewLine(entry: RoutineEntry): string {
  const titles = entry.payload.tasks.map((t) => t.title)
  const shown = titles.slice(0, 3)
  const more = titles.length - shown.length
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ')
}

/**
 * "Add routine…": pick a day (today, tomorrow, or a date) and press Add on a routine. Its tasks are created
 * at once, with a toast that undoes it. Yours come first, then the built-in starters.
 */
export function RoutinePicker({ onGone }: { onGone: () => void }) {
  const { open, close } = useDialogLifecycle(onGone)
  const today = useToday()
  const actions = useRitualActions()
  const entries = useRoutineEntries()
  const [when, setWhen] = useState<When>('today')
  const [date, setDate] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const day = when === 'today' ? today : when === 'tomorrow' ? addDays(today, 1) : date
  const validDay = day !== null && day >= today

  async function add(entry: RoutineEntry): Promise<void> {
    if (!validDay || day === null || busy !== null) return
    setBusy(entry.id)
    const added = await actions.apply(entry, day, today)
    setBusy(null)
    if (added > 0) close()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a routine"
      description="Adds its tasks to the day you choose. You can undo it right after."
    >
      <div className={dialog.body} data-testid="routine-picker">
        <div className={styles.when}>
          <SegmentedControl
            label="Add to"
            size="sm"
            value={when}
            onValueChange={setWhen}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'tomorrow', label: 'Tomorrow' },
              { value: 'date', label: 'Pick a date' },
            ]}
          />
          {when === 'date' ? (
            <DatePicker
              value={date}
              onChange={setDate}
              label="Add routine on"
              min={today}
              today={today}
              size="sm"
              clearable={false}
            />
          ) : null}
        </div>

        {entries === undefined ? (
          <div className={dialog.skeleton} role="status" aria-label="Loading routines">
            <Skeleton variant="block" height={52} />
            <Skeleton variant="block" height={52} />
          </div>
        ) : (
          <ul className={dialog.list} aria-label="Routines">
            {entries.map((entry) => (
              <li key={entry.id} className={dialog.row} data-testid="routine-option">
                <span className={styles.icon} aria-hidden="true">
                  {entry.icon}
                </span>
                <div className={dialog.rowMain}>
                  <span className={dialog.rowTitle}>
                    {entry.name}
                    {entry.builtIn ? <span className={styles.badge}>Starter</span> : null}
                  </span>
                  <span className={dialog.rowMeta}>{routineSummary(entry)}</span>
                  <span className={dialog.rowMeta}>{previewLine(entry)}</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!validDay || (busy !== null && busy !== entry.id)}
                  loading={busy === entry.id}
                  onClick={() => void add(entry)}
                  aria-label={`Add ${entry.name}`}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}
        {when === 'date' && !validDay ? (
          <p className={dialog.hint}>Pick today or a later day.</p>
        ) : null}
      </div>
    </Modal>
  )
}

/**
 * "Save as a routine": name it and tick the tasks of today's list to keep (their titles, lengths, times of
 * day and goals; not their dates or notes). It then shows up in the picker and in Settings.
 */
export function SaveRoutine({ onGone }: { onGone: () => void }) {
  const { open, close } = useDialogLifecycle(onGone)
  const today = useToday()
  const toast = useToast()
  const lists = useTodayLists(today)
  const [name, setName] = useState('')
  const [unchecked, setUnchecked] = useState<ID[]>([])
  const [saving, setSaving] = useState(false)

  const candidates = useMemo(
    () => (lists ? [...lists.open.filter((i) => i.carriedFrom === null).map((i) => i.task), ...lists.done] : []),
    [lists],
  )
  const chosen = candidates.filter((t) => !unchecked.includes(t.id)).slice(0, ROUTINE_TASKS_MAX)
  const minutes = routinePayloadFromTasks(chosen).tasks.reduce(
    (sum, t) => sum + (t.durationMinutes ?? 0),
    0,
  )
  const canSave = name.trim() !== '' && chosen.length > 0

  async function save(e?: FormEvent): Promise<void> {
    e?.preventDefault()
    if (!canSave || saving) return
    setSaving(true)
    try {
      const made = await createRoutine({ name, payload: routinePayloadFromTasks(chosen) })
      toast.show({
        title: `Saved “${made.template.name}”`,
        description: 'Add it to any day from the command palette.',
        variant: 'success',
        undo: made.undo,
      })
      close()
    } catch (error) {
      recordError(error, 'saveRoutine')
      toast.error('Couldn’t save that routine', { description: 'Nothing was changed. Try again.' })
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Save as a routine"
      description="Keep a set of tasks you repeat, then add it to any day in one click."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSave} loading={saving} onClick={() => void save()}>
            Save routine
          </Button>
        </>
      }
    >
      <form className={dialog.body} onSubmit={(e) => void save(e)} data-testid="save-routine">
        <Input
          label="Name"
          placeholder="e.g. Study day"
          value={name}
          maxLength={ROUTINE_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          data-autofocus
        />
        <div className={dialog.body}>
          <p className={dialog.stepLabel}>
            Tasks from today{chosen.length > 0 ? ` · ${chosen.length} chosen` : ''}
            {minutes > 0 ? ` · ${durationText(minutes)}` : ''}
          </p>
          {lists === undefined ? (
            <div className={dialog.skeleton} role="status" aria-label="Loading today’s tasks">
              <Skeleton width="80%" />
              <Skeleton width="60%" />
            </div>
          ) : candidates.length === 0 ? (
            <p className={dialog.quiet}>
              There are no tasks on today’s list to save. Add a few tasks first, then save them as
              a routine.
            </p>
          ) : (
            <ul className={dialog.list} aria-label="Tasks to save">
              {candidates.map((task) => (
                <li key={task.id} className={dialog.row}>
                  <Checkbox
                    className={dialog.pick}
                    checked={!unchecked.includes(task.id)}
                    onCheckedChange={(checked) =>
                      setUnchecked((ids) =>
                        checked ? ids.filter((id) => id !== task.id) : [...ids, task.id],
                      )
                    }
                    label={<span className={dialog.rowTitle}>{task.title}</span>}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </form>
    </Modal>
  )
}
