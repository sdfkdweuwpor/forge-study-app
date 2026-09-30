import { Check } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { format } from 'date-fns'
import { useToday } from '@/app/hooks/useToday'
import { recordError } from '@/app/reportError'
import { completeEvening, moveUndoneToTomorrow, saveReflection } from '@/db/repos/rituals'
import type { ID, Task } from '@/db/types'
import { addDays, isISODate } from '@/logic/dates'
import {
  REFLECTION_MAX,
  XP_EVENING,
  cleanReflection,
  dayWords,
  doneHeadline,
  isPlannedLater,
  movableIds,
  moveLabel,
  openHeadline,
} from '@/logic/rituals'
import { durationText } from '@/logic/statsLabels'
import { formatTimeOfDay, formatXp } from '@/logic/taskDisplay'
import { planDay, planTime } from '@/logic/taskDates'
import { carriedFromText, estimateText } from '@/logic/todayStats'
import { Button } from '@/ui/Button'
import { DatePicker } from '@/ui/DatePicker'
import { Input } from '@/ui/Input'
import { Modal } from '@/ui/Modal'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/Toast'
import { useRitualActions } from './actions'
import { useFocusMinutes, useRitual, useTasksByIds, useTodayLists } from './queries'
import { StepHeading } from './Steps'
import { useDialogLifecycle } from './useDialog'
import styles from './Dialog.module.css'

const STEP_TITLES = ['Done today', 'Still open', 'One line for yourself'] as const

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

type Undo = () => Promise<void>

/**
 * The evening shutdown (BRIEF §5.11): look at what got done, move what did not (one click, or task by
 * task: tomorrow, a day you pick, or leave it), and leave one optional line. Completing pays +10 XP once
 * a day, with a toast that can undo it. Every move has an Undo, on the row, in the line under the button
 * and on the toast.
 */
export function EveningShutdown({ onGone }: { onGone: () => void }) {
  const { open, close } = useDialogLifecycle(onGone)
  const today = useToday()
  const tomorrow = addDays(today, 1)
  const toast = useToast()
  const actions = useRitualActions()
  const lists = useTodayLists(today)
  const ritual = useRitual('evening', today)
  const focusMinutes = useFocusMinutes(today)

  const [step, setStep] = useState(0)
  const [left, setLeft] = useState<ID[]>([])
  const [movedNow, setMovedNow] = useState<ID[]>([])
  const [rowUndos, setRowUndos] = useState<Record<ID, Undo>>({})
  const [banner, setBanner] = useState<{ text: string; undo: Undo } | null>(null)
  const [picking, setPicking] = useState<ID | null>(null)
  const [pickedDay, setPickedDay] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const saved = useRef<string | null>(null)

  const ready = lists !== undefined && ritual !== undefined

  // Rows stay on screen after they are moved, so you can see what happened (and undo it): remember
  // every task this list has shown, and read each one's current state.
  const [seen, setSeen] = useState<ID[]>([])
  const openIds = lists?.open.map((i) => i.task.id) ?? []
  const fresh = openIds.filter((id) => !seen.includes(id))
  if (fresh.length > 0) setSeen([...seen, ...fresh])
  const seenTasks = useTasksByIds(seen)
  const rows = useMemo(
    () => (seenTasks ?? []).filter((t): t is Task => t !== undefined),
    [seenTasks],
  )

  const leftSet = useMemo(() => new Set(left), [left])
  const movable = lists ? movableIds(lists.open, today, leftSet) : []
  // Still open on Today: not finished, not already planned for a later day.
  const stillOpen = rows.filter((t) => t.status !== 'done' && !isPlannedLater(t, today)).length
  const reflection = text ?? ritual?.reflection ?? ''
  const closedAt = ritual?.completedAt ?? null

  async function moveAll(): Promise<void> {
    if (busy || movable.length === 0) return
    setBusy(true)
    try {
      const result = await moveUndoneToTomorrow(today, { leave: left })
      if (result.moved.length === 0) return
      const undo: Undo = async () => {
        await result.undo()
        setBanner(null)
        setMovedNow((ids) => ids.filter((id) => !result.moved.includes(id)))
      }
      setMovedNow((ids) => [...ids, ...result.moved])
      setBanner({ text: `Moved ${plural(result.moved.length, 'task')} to tomorrow.`, undo })
      toast.show({
        title: `Moved ${plural(result.moved.length, 'task')} to tomorrow`,
        description: 'They are waiting on Today tomorrow.',
        undo,
      })
    } catch (error) {
      recordError(error, 'eveningShutdown.moveAll')
      toast.error('Couldn’t move the tasks', { description: 'Nothing was changed. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  async function moveOne(task: Task, day: string): Promise<void> {
    const result = await actions.move([task.id], day, today)
    if (!result || result.moved.length === 0) return
    const undo: Undo = async () => {
      await result.undo()
      setMovedNow((ids) => ids.filter((x) => x !== task.id))
      setRowUndos((current) => {
        const { [task.id]: _gone, ...rest } = current
        return rest
      })
      setBanner(null)
    }
    setMovedNow((ids) => [...ids, task.id])
    setRowUndos((u) => ({ ...u, [task.id]: undo }))
    setBanner({ text: `Moved “${task.title}” to ${dayWords(day, today)}.`, undo })
    setPicking(null)
    setPickedDay(null)
  }

  async function persistReflection(): Promise<void> {
    if (text === null) return
    const clean = cleanReflection(text)
    if (clean === (saved.current ?? ritual?.reflection ?? '')) return
    saved.current = clean
    try {
      await saveReflection(today, clean)
    } catch (error) {
      recordError(error, 'eveningShutdown.saveReflection')
    }
  }

  function requestClose(): void {
    void persistReflection()
    close()
  }

  async function complete(e?: FormEvent): Promise<void> {
    e?.preventDefault()
    if (saving || !ready) return
    setSaving(true)
    try {
      const result = await completeEvening(today, { reflection })
      saved.current = result.ritual.reflection
      if (result.xp) {
        toast.xp('Evening shutdown done', {
          description: `${formatXp(result.xp.amount)} · Rest well.`,
          undo: result.undo,
        })
      } else {
        toast.show({ title: 'Saved', description: 'Your reflection is saved.', variant: 'success' })
      }
      close()
    } catch (error) {
      recordError(error, 'eveningShutdown.complete')
      toast.error('Couldn’t finish the shutdown', {
        description: 'Nothing was changed. Try again.',
      })
      setSaving(false)
    }
  }

  const last = step === STEP_TITLES.length - 1
  const footer = (
    <>
      {step > 0 ? (
        <Button variant="ghost" onClick={() => setStep(step - 1)}>
          Back
        </Button>
      ) : null}
      {last ? (
        <Button
          variant="primary"
          disabled={!ready}
          loading={saving}
          onClick={() => void complete()}
        >
          {closedAt === null ? `Finish · ${formatXp(XP_EVENING)}` : 'Save'}
        </Button>
      ) : (
        <Button variant="primary" disabled={!ready} onClick={() => setStep(step + 1)}>
          Next
        </Button>
      )}
    </>
  )

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title="Evening shutdown"
      description={
        closedAt !== null
          ? `You closed the day at ${format(closedAt, 'h:mm a')}.`
          : 'A few minutes to close the day.'
      }
      footer={footer}
      closeOnEsc={!saving}
    >
      <div className={styles.body} data-testid="evening-shutdown" aria-busy={!ready || undefined}>
        <StepHeading step={step} total={STEP_TITLES.length} title={STEP_TITLES[step] ?? ''} />

        {!ready ? (
          <div className={styles.skeleton} role="status" aria-label="Loading your day">
            <Skeleton width="70%" />
            <Skeleton width="50%" />
            <Skeleton width="60%" />
          </div>
        ) : null}

        {ready && step === 0 ? (
          <>
            <p className={styles.lede} role="status">
              {doneHeadline(lists.done.length)}
              {focusMinutes !== undefined && focusMinutes > 0
                ? ` ${durationText(focusMinutes)} of focus.`
                : ''}
            </p>
            {lists.done.length > 0 ? (
              <ul className={styles.list} aria-label="Done today">
                {lists.done.map((task) => (
                  <li key={task.id} className={styles.row}>
                    <Check className={styles.tick} aria-hidden="true" />
                    <span className={styles.rowTitle}>{task.title}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {ready && step === 1 ? (
          <>
            <p className={styles.lede}>{openHeadline(stillOpen)}</p>
            {rows.length > 0 ? (
              <>
                <div className={styles.status}>
                  <Button
                    variant="primary"
                    disabled={movable.length === 0}
                    loading={busy}
                    onClick={() => void moveAll()}
                  >
                    {movable.length > 0 ? moveLabel(movable.length) : 'Nothing left to move'}
                  </Button>
                  {/* Always present, so a screen reader announces what just moved. */}
                  <span role="status" className={styles.status} data-tone="done">
                    {banner ? (
                      <>
                        {banner.text}
                        <Button size="sm" variant="ghost" onClick={() => void banner.undo()}>
                          Undo
                        </Button>
                      </>
                    ) : null}
                  </span>
                </div>
                <ul className={styles.list} aria-label="Still open today">
                  {rows.map((task) => (
                    <MoveRow
                      key={task.id}
                      task={task}
                      today={today}
                      left={leftSet.has(task.id)}
                      movedNow={movedNow.includes(task.id)}
                      undo={rowUndos[task.id]}
                      picking={picking === task.id}
                      pickedDay={pickedDay}
                      tomorrow={tomorrow}
                      onTomorrow={() => void moveOne(task, tomorrow)}
                      onLeave={() => setLeft((ids) => [...ids, task.id])}
                      onStay={() => setLeft((ids) => ids.filter((id) => id !== task.id))}
                      onStartPick={() => {
                        setPicking(task.id)
                        setPickedDay(null)
                      }}
                      onCancelPick={() => setPicking(null)}
                      onPickedDay={setPickedDay}
                      onConfirmPick={() => pickedDay !== null && void moveOne(task, pickedDay)}
                    />
                  ))}
                </ul>
              </>
            ) : (
              <p className={styles.quiet}>
                {lists.done.length > 0
                  ? 'Everything planned for today is done. Tomorrow starts clear.'
                  : 'Nothing was planned for today. Tomorrow starts clear.'}
              </p>
            )}
          </>
        ) : null}

        {ready && step === 2 ? (
          <form onSubmit={(e) => void complete(e)} className={styles.body}>
            <Input
              label="One line about today (optional)"
              hint="Just for you. It stays on this device, and you can read it back on Progress."
              placeholder="What went well, or what would you tell tomorrow’s you?"
              value={reflection}
              maxLength={REFLECTION_MAX}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => void persistReflection()}
              autoComplete="off"
              enterKeyHint="done"
            />
          </form>
        ) : null}
      </div>
    </Modal>
  )
}

interface MoveRowProps {
  task: Task
  today: string
  tomorrow: string
  left: boolean
  movedNow: boolean
  undo: Undo | undefined
  picking: boolean
  pickedDay: string | null
  onTomorrow: () => void
  onLeave: () => void
  onStay: () => void
  onStartPick: () => void
  onCancelPick: () => void
  onPickedDay: (day: string | null) => void
  onConfirmPick: () => void
}

function MoveRow({
  task,
  today,
  tomorrow,
  left,
  movedNow,
  undo,
  picking,
  pickedDay,
  onTomorrow,
  onLeave,
  onStay,
  onStartPick,
  onCancelPick,
  onPickedDay,
  onConfirmPick,
}: MoveRowProps) {
  const day = planDay(task)
  const done = task.status === 'done'
  const moved = !done && isPlannedLater(task, today)
  const time = planTime(task)
  const length =
    task.durationMinutes !== null ? durationText(task.durationMinutes) : estimateText(task)
  const meta = [
    day !== null && day < today ? carriedFromText(day, today) : null,
    day !== null && day >= today && time !== null ? formatTimeOfDay(time) : null,
    length,
  ]
    .filter(Boolean)
    .join(' · ')
  const canConfirm = pickedDay !== null && isISODate(pickedDay) && pickedDay >= tomorrow

  return (
    <li className={styles.moveRow}>
      <div className={styles.moveHead}>
        <span className={styles.rowTitle} data-done={done}>
          {task.title}
        </span>
        {meta !== '' ? <span className={styles.rowMeta}>{meta}</span> : null}
      </div>

      {done ? <span className={styles.moveState}>Done</span> : null}

      {moved && day !== null ? (
        <div className={styles.moveActions}>
          <span className={styles.moveState} data-tone="moved">
            {movedNow ? 'Moved to' : 'Planned for'} {dayWords(day, today)}
          </span>
          {undo ? (
            <Button size="sm" variant="ghost" onClick={() => void undo()}>
              Undo
            </Button>
          ) : null}
        </div>
      ) : null}

      {!done && !moved && left ? (
        <div className={styles.moveActions}>
          <span className={styles.moveState}>Staying on today</span>
          <Button size="sm" variant="ghost" onClick={onStay}>
            Change
          </Button>
        </div>
      ) : null}

      {!done && !moved && !left && picking ? (
        <div className={styles.datePick}>
          <DatePicker
            value={pickedDay}
            onChange={onPickedDay}
            label={`Move ${task.title} to`}
            min={tomorrow}
            today={today}
            size="sm"
            clearable={false}
          />
          <Button size="sm" variant="secondary" disabled={!canConfirm} onClick={onConfirmPick}>
            Move
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelPick}>
            Cancel
          </Button>
        </div>
      ) : null}

      {!done && !moved && !left && !picking ? (
        <div className={styles.moveActions}>
          <Button
            size="sm"
            variant="ghost"
            onClick={onTomorrow}
            aria-label={`Move ${task.title} to tomorrow`}
          >
            Tomorrow
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onStartPick}
            aria-label={`Pick a date for ${task.title}`}
          >
            Pick a date
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onLeave}
            aria-label={`Leave ${task.title} on today`}
          >
            Leave
          </Button>
        </div>
      ) : null}
    </li>
  )
}
