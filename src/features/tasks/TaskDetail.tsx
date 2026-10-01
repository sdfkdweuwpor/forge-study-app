import { format } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { recordError } from '@/app/reportError'
import { setTaskStatus, updateTask } from '@/db/repos/tasks'
import type { Priority, Task, TaskStatus } from '@/db/types'
import { formatXp } from '@/logic/taskDisplay'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/Checkbox'
import { Input } from '@/ui/Input'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { AutoSlotToggle, DeadlineEditor, DueEditor, DurationField } from './DueEditor'
import { InlineTitle } from './InlineTitle'
import { NotesField } from './NotesField'
import { priorityLabel } from './priority'
import { ProjectField } from './ProjectField'
import { RecurrenceField } from './RecurrenceField'
import { SubtasksField } from './SubtasksField'
import { TagsField } from './TagsField'
import { useTaskActions } from './TaskActions'
import { useTaskXp } from './queries'
import styles from './TaskDetail.module.css'

interface TaskDetailProps {
  task: Task
  /** `page`: the title is the page's h1. `peek`: an h2 inside the side panel. */
  variant: 'page' | 'peek'
  /** Bump to move focus to the tags field (the `#` shortcut). */
  focusTagsNonce?: number
  /** After the task was moved to the trash from here. */
  onDeleted?: () => void
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.prop}>
      <div className={styles.propLabel}>{label}</div>
      <div className={styles.propValue}>{children}</div>
    </div>
  )
}

/** The estimate in pomodoros. Commits on Enter or blur; the key remounts it when the value changes elsewhere. */
function EstimateField({
  task,
}: {
  task: Pick<Task, 'id' | 'estimatePomodoros' | 'estimateMinutes'>
}) {
  const [draft, setDraft] = useState(
    task.estimatePomodoros === null ? '' : String(task.estimatePomodoros),
  )

  function commit() {
    const n = draft.trim() === '' ? null : Math.max(0, Math.min(99, Math.round(Number(draft))))
    const next = n === null || Number.isNaN(n) || n === 0 ? null : n
    if (next === task.estimatePomodoros) {
      setDraft(next === null ? '' : String(next))
      return
    }
    updateTask(task.id, { estimatePomodoros: next }).catch((error: unknown) =>
      recordError(error, 'saveEstimate'),
    )
  }

  const shown = Number(draft) > 0 ? Math.round(Number(draft)) * 25 : null
  return (
    <div className={styles.estimate}>
      <Input
        type="number"
        size="sm"
        min={0}
        max={99}
        inputMode="numeric"
        className={styles.estimateInput}
        aria-label="Estimate in pomodoros"
        placeholder="0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      <span className={styles.hint}>
        pomodoros{shown ? ` · about ${shown} min` : ''}
        {task.estimateMinutes ? ` · ${task.estimateMinutes} min planned` : ''}
      </span>
    </div>
  )
}

/**
 * Every field of a task (BRIEF §5.3), edited in place, no Save button: status, due date and time,
 * priority, estimate, repeat, tags, goal or course, subtasks and notes. Used by the side peek panel
 * and the full task page.
 */
export function TaskDetail({ task, variant, focusTagsNonce = 0, onDeleted }: TaskDetailProps) {
  const actions = useTaskActions()
  const xp = useTaskXp(task.id)
  const [editingTitle, setEditingTitle] = useState(false)
  // The peek keeps one TaskDetail while `j`/`k` move between tasks; editing does not follow along.
  const [titleTask, setTitleTask] = useState(task.id)
  if (titleTask !== task.id) {
    setTitleTask(task.id)
    setEditingTitle(false)
  }
  const tagsInput = useRef<HTMLInputElement | null>(null)
  const priorityGroup = useRef<HTMLDivElement | null>(null)
  const dueId = `${task.id}-due`

  const { registerRow } = actions
  useEffect(
    () =>
      registerRow(task.id, {
        edit: () => setEditingTitle(true),
        openPanel: (kind) => {
          if (kind === 'due') document.getElementById(dueId)?.focus()
          else if (kind === 'priority') {
            priorityGroup.current
              ?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
              ?.focus()
          }
        },
      }),
    [registerRow, task.id, dueId],
  )

  useEffect(() => {
    if (focusTagsNonce > 0) tagsInput.current?.focus()
  }, [focusTagsNonce])

  const done = task.status === 'done'
  const Heading = variant === 'page' ? 'h1' : 'h2'

  function setStatus(status: TaskStatus) {
    if (status === task.status) return
    if (status === 'done') actions.complete(task)
    // Leaving Done takes XP back, so it goes through the action that says so and offers Undo.
    else if (task.status === 'done') actions.uncomplete(task, status)
    else setTaskStatus(task.id, status).catch((error: unknown) => recordError(error, 'setStatus'))
  }

  return (
    <div className={styles.root} data-variant={variant}>
      <div className={styles.head}>
        <Checkbox
          variant="round"
          className={styles.check}
          aria-label={`Done: ${task.title}`}
          checked={done}
          onCheckedChange={() => actions.toggleComplete(task)}
        />
        <Heading className={styles.title}>
          <InlineTitle
            key={task.id}
            value={task.title}
            label="Task title"
            done={done}
            editing={editingTitle}
            onEditingChange={setEditingTitle}
            onCommit={(title) => void actions.rename(task.id, title)}
          />
        </Heading>
      </div>

      <div className={styles.props}>
        <Property label="Status">
          <SegmentedControl<TaskStatus>
            label="Status"
            size="sm"
            value={task.status}
            onValueChange={setStatus}
            options={[
              { value: 'todo', label: 'To do' },
              { value: 'doing', label: 'Doing' },
              { value: 'done', label: 'Done' },
            ]}
          />
        </Property>

        <Property label="Do">
          <DueEditor id={dueId} size="sm" task={task} />
        </Property>

        <Property label="Length">
          <DurationField task={task} />
        </Property>

        <Property label="Deadline">
          <DeadlineEditor size="sm" task={task} />
          <AutoSlotToggle task={task} />
        </Property>

        <Property label="Priority">
          <div ref={priorityGroup}>
            <SegmentedControl<`${Priority}`>
              label="Priority"
              size="sm"
              value={`${task.priority}`}
              onValueChange={(p) => void actions.setPriority(task.id, Number(p) as Priority)}
              options={([0, 1, 2, 3, 4] as const).map((p) => ({
                value: `${p}` as const,
                label: p === 0 ? 'None' : priorityLabel(p),
              }))}
            />
          </div>
        </Property>

        <Property label="Estimate">
          <EstimateField key={`${task.id}:${task.estimatePomodoros}`} task={task} />
        </Property>

        <Property label="Repeat">
          <RecurrenceField task={task} />
        </Property>

        <Property label="Tags">
          <TagsField task={task} inputRef={tagsInput} />
        </Property>

        <Property label="Goal or course">
          <ProjectField task={task} />
        </Property>
      </div>

      <SubtasksField task={task} />

      <section className={styles.notes} aria-labelledby={`notes-${task.id}`}>
        <h3 className={styles.sectionHeading} id={`notes-${task.id}`}>
          Notes
        </h3>
        <NotesField key={task.id} task={task} className={styles.editor} />
      </section>

      <footer className={styles.foot}>
        <p className={styles.footText}>
          Added {format(task.createdAt, 'MMM d, yyyy')}
          {done && task.completedAt !== null
            ? ` · Completed ${format(task.completedAt, 'MMM d, h:mm a')}`
            : ''}
          {done && xp !== undefined && xp > 0 ? (
            <>
              {' · '}
              <span className={styles.xp}>{formatXp(xp)}</span>
            </>
          ) : null}
          {task.source === 'schedule' ? ' · Planned by your goal schedule' : ''}
          {task.schedulePinned ? ' · Pinned to this date' : ''}
        </p>
        <Button
          variant="danger"
          size="sm"
          iconLeft={<Trash2 />}
          onClick={() => {
            actions.trash(task)
            onDeleted?.()
          }}
        >
          Move to trash
        </Button>
      </footer>
    </div>
  )
}
