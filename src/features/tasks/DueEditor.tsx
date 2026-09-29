import type { Task } from '@/db/types'
import { DatePicker } from '@/ui/DatePicker'
import { useTaskActions, useTaskEnv } from './TaskActions'
import styles from './DueEditor.module.css'

interface DueEditorProps {
  task: Pick<Task, 'id' | 'dueDate' | 'dueTime' | 'recurrence'>
  id?: string
  size?: 'sm' | 'md'
}

/**
 * Due date and time with the quick picks, for the task page, the peek and the row's date picker.
 * A repeating task always has a date (its rule is anchored to it), so the date cannot be cleared
 * while it repeats; the copy under the field says why and how to get there.
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
        label="Due date"
        value={task.dueDate}
        // A repeating task keeps its date: the native field's own "clear" is ignored (the input
        // is controlled, so it shows the date again).
        onChange={(date) => {
          if (date === null && repeats) return
          void actions.setDue(task.id, date)
        }}
        withTime
        time={task.dueTime}
        onTimeChange={(time) => {
          // Clearing the time must not write the date back (the clear button also clears the date).
          if (time === null || task.dueDate !== null) void actions.setDueTime(task.id, time)
          else void actions.setDue(task.id, today, time)
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
