import type { Task } from '@/db/types'
import { durationLabel } from '@/logic/quickAdd'
import { DatePicker } from '@/ui/DatePicker'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Toggle } from '@/ui/Toggle'
import { useTaskActions, useTaskEnv } from './TaskActions'
import styles from './DueEditor.module.css'

interface DueEditorProps {
  task: Pick<Task, 'id' | 'doDate' | 'doTime' | 'recurrence'>
  id?: string
  size?: 'sm' | 'md'
}

/**
 * The day (and time) a task is planned for, with the quick picks, for the task page, the peek and the
 * row's date picker. A repeating task always has a date (its rule is anchored to it), so the date
 * cannot be cleared while it repeats; the copy under the field says why and how to get there.
 */
export function DueEditor({ task, id, size }: DueEditorProps) {
  const actions = useTaskActions()
  const { today, weekStartsOn } = useTaskEnv()
  const repeats = task.recurrence !== null

  return (
    <>
      <DatePicker
        {...(id ? { id } : {})}
        {...(size ? { size } : {})}
        label="Date"
        value={task.doDate}
        // A repeating task keeps its date: the native field's own "clear" is ignored (the input
        // is controlled, so it shows the date again).
        onChange={(date) => {
          if (date === null && repeats) return
          void actions.setDate(task.id, date)
        }}
        withTime
        time={task.doTime}
        onTimeChange={(time) => {
          // Clearing the time must not write the date back (the clear button also clears the date).
          if (time === null || task.doDate !== null) void actions.setTime(task.id, time)
          else void actions.setDate(task.id, today, time)
        }}
        quickPicks
        clearable={!repeats}
        today={today}
        weekStartsOn={weekStartsOn}
      />
      {repeats ? (
        <p className={styles.hint}>
          Repeating tasks need a date. Set Repeat to “Does not repeat” to clear it.
        </p>
      ) : null}
    </>
  )
}

interface DeadlineEditorProps {
  task: Pick<Task, 'id' | 'dueDate' | 'dueTime'>
  id?: string
  size?: 'sm' | 'md'
}

/** A hard deadline, only when there is one: it shows as a calm "Due Fri" chip on the task. */
export function DeadlineEditor({ task, id, size }: DeadlineEditorProps) {
  const actions = useTaskActions()
  const { today, weekStartsOn } = useTaskEnv()
  return (
    <DatePicker
      {...(id ? { id } : {})}
      {...(size ? { size } : {})}
      label="Deadline"
      value={task.dueDate}
      onChange={(date) => void actions.setDeadline(task.id, date)}
      withTime
      time={task.dueTime}
      onTimeChange={(time) => {
        if (time === null || task.dueDate !== null) void actions.setDeadlineTime(task.id, time)
        else void actions.setDeadline(task.id, today, time)
      }}
      clearable
      today={today}
      weekStartsOn={weekStartsOn}
    />
  )
}

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120] as const

interface DurationFieldProps {
  task: Pick<Task, 'id' | 'durationMinutes'>
}

/** How long the planned slot is: a few common lengths (a custom one from quick add is kept and shown). */
export function DurationField({ task }: DurationFieldProps) {
  const actions = useTaskActions()
  const current = task.durationMinutes
  const presets: number[] =
    current !== null && !(DURATION_PRESETS as readonly number[]).includes(current)
      ? [...DURATION_PRESETS, current].sort((a, b) => a - b)
      : [...DURATION_PRESETS]
  return (
    <SegmentedControl<string>
      label="Length"
      size="sm"
      value={current === null ? 'none' : String(current)}
      onValueChange={(v) => void actions.setDuration(task.id, v === 'none' ? null : Number(v))}
      options={[
        { value: 'none', label: 'Any' },
        ...presets.map((m) => ({
          value: String(m),
          label: m < 60 ? `${m}m` : durationLabel(m).replace(' h', 'h').replace(' min', 'm'),
        })),
      ]}
    />
  )
}

interface AutoSlotToggleProps {
  task: Pick<Task, 'id' | 'autoSlot' | 'dueDate' | 'doDate' | 'status'>
}

/**
 * "Auto-schedule before deadline": only for a task with a deadline and no day of its own. It never
 * places anything by itself: a suggested time shows up in "Suggested times" and needs a yes.
 */
export function AutoSlotToggle({ task }: AutoSlotToggleProps) {
  const actions = useTaskActions()
  if (task.dueDate === null || task.doDate !== null || task.status === 'done') return null
  return (
    <div className={styles.autoSlot}>
      <Toggle
        size="sm"
        label="Auto-schedule before deadline"
        checked={task.autoSlot}
        onCheckedChange={(on) => void actions.setAutoSlot(task.id, on)}
      />
      <p className={styles.hint}>I’ll suggest a time in your open hours. You confirm it first.</p>
    </div>
  )
}
