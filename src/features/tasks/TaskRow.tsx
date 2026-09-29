import { format } from 'date-fns'
import { CalendarDays, Clock, FileText, ListChecks, Repeat, Timer } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Task } from '@/db/types'
import { describeRecurrence } from '@/logic/recurrence'
import { normalizeTag, tagColor } from '@/logic/tagColor'
import { dueLabel, estimateLabel, formatXp, subtaskProgress } from '@/logic/taskDisplay'
import { Checkbox } from '@/ui/Checkbox'
import { Tag } from '@/ui/Tag'
import { InlineTitle } from './InlineTitle'
import { PriorityFlag } from './PriorityFlag'
import { useTaskActions, useTaskEnv, type TaskMotion } from './TaskActions'
import { TaskMenu, type RowPanel } from './TaskMenu'
import { openTask } from './taskUrls'
import styles from './TaskRow.module.css'

export interface TaskRowProps {
  task: Task
  /** The keyboard selection (j / k). */
  selected?: boolean
  onSelect?: (id: string) => void
  /** Present while the task is completing: keeps the row on screen and drives its motion. */
  motion?: TaskMotion
  /** The `⋮⋮` drag handle, supplied by a sortable list. */
  handle?: ReactNode
  dragging?: boolean
  /** Hide the course chip where the surrounding list already says which course it is. */
  showCourse?: boolean
  /** XP this finished task earned, shown in gold (the Completed list). */
  xp?: number
  /**
   * Scroll the row into view when it becomes selected. Only for keyboard selection: scrolling on a
   * click would move the row between pointer-down and pointer-up and swallow the click.
   */
  reveal?: boolean
}

/**
 * One task: round checkbox, a title you edit in place, and meta chips (course, tags, checklist
 * progress, repeat, estimate, priority, due date). The `…` menu and the drag handle appear on hover.
 * Clicking anywhere else on the row opens the task. Completion runs the BRIEF §3.5 motion.
 */
export const TaskRow = memo(function TaskRow({
  task,
  selected = false,
  onSelect,
  motion,
  handle,
  dragging = false,
  showCourse = true,
  xp,
  reveal = false,
}: TaskRowProps) {
  const actions = useTaskActions()
  const { today, tagColors, projects, canEditInPlace } = useTaskEnv()
  const [editing, setEditing] = useState(false)
  const [panel, setPanel] = useState<RowPanel | null>(null)
  const root = useRef<HTMLDivElement | null>(null)

  const { registerRow } = actions
  useEffect(
    () =>
      registerRow(task.id, {
        edit: () => setEditing(true),
        openPanel: (kind) => setPanel(kind),
      }),
    [registerRow, task.id],
  )

  useEffect(() => {
    if (selected && reveal) root.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, reveal])

  const phase = motion?.phase
  const struck = phase === 'struck' || phase === 'leaving'
  const checked = task.status === 'done' || phase !== undefined
  const titleDone = struck || (task.status === 'done' && phase === undefined)
  // A finished row shows when it was done, not when it was due.
  const finished = task.status === 'done' && phase === undefined

  const course =
    showCourse && task.milestoneId ? projects?.courseById.get(task.milestoneId) : undefined
  const courseCode = course?.code ?? null
  const tags = useMemo(
    () =>
      task.tags.filter((t) => courseCode === null || normalizeTag(t) !== normalizeTag(courseCode)),
    [task.tags, courseCode],
  )
  const due = dueLabel(task, today)
  const estimate = estimateLabel(task)
  const checklist = subtaskProgress(task.subtasks)
  const hasNotes = task.notes.some((b) => b.type === 'divider' || b.text.trim() !== '')

  return (
    <div className={styles.collapse} data-phase={phase} data-motion="opacity">
      <div className={styles.inner}>
        <div
          ref={root}
          className={styles.row}
          data-selected={selected || undefined}
          data-done={task.status === 'done' || undefined}
          data-doing={task.status === 'doing' || undefined}
          data-dragging={dragging || undefined}
          data-menu-open={panel !== null || undefined}
          data-priority={task.priority}
          onPointerDownCapture={() => onSelect?.(task.id)}
          onFocusCapture={() => onSelect?.(task.id)}
        >
          <button
            type="button"
            className={styles.open}
            tabIndex={-1}
            aria-label={`Open ${task.title}`}
            onClick={() => openTask(task.id)}
          />
          {handle ? <div className={styles.handle}>{handle}</div> : null}
          <Checkbox
            variant="round"
            className={styles.check}
            aria-label={`${task.status === 'done' || phase ? 'Mark not done' : 'Mark done'}: ${task.title}`}
            checked={checked}
            onCheckedChange={() => actions.toggleComplete(task)}
            onCheckAnimationEnd={() => actions.checkAnimationEnd(task.id)}
          />

          <div className={styles.body}>
            <InlineTitle
              className={styles.title}
              value={task.title}
              label="Task title"
              done={titleDone}
              editing={editing}
              onEditingChange={setEditing}
              editable={canEditInPlace}
              onActivate={() => openTask(task.id)}
              onCommit={(title) => void actions.rename(task.id, title)}
            />

            <div className={styles.meta}>
              {task.status === 'doing' ? <span className={styles.doing}>Doing</span> : null}
              {courseCode ? (
                <Tag size="sm" color={tagColor(courseCode, tagColors)}>
                  {courseCode}
                </Tag>
              ) : null}
              {tags.map((tag) => (
                <Tag key={tag} size="sm" color={tagColor(tag, tagColors)}>
                  {tag}
                </Tag>
              ))}
              {hasNotes ? (
                <span className={styles.icon}>
                  <FileText size={13} aria-hidden="true" />
                  <span className="sr-only">Has notes</span>
                </span>
              ) : null}
              {checklist ? (
                <span className={styles.chip}>
                  <ListChecks size={13} aria-hidden="true" />
                  <span>{checklist.text}</span>
                  <span className="sr-only"> steps done</span>
                </span>
              ) : null}
              {task.recurrence ? (
                <span className={styles.icon}>
                  <Repeat size={13} aria-hidden="true" />
                  <span className="sr-only">{describeRecurrence(task.recurrence)}</span>
                </span>
              ) : null}
              {estimate ? (
                <span className={styles.chip}>
                  <Timer size={13} aria-hidden="true" />
                  <span>{estimate.text}</span>
                  <span className="sr-only"> ({estimate.description})</span>
                </span>
              ) : null}
              {task.priority > 0 ? <PriorityFlag priority={task.priority} /> : null}
              {finished ? (
                <>
                  {task.completedAt !== null ? (
                    <span className={styles.chip}>
                      <Clock size={13} aria-hidden="true" />
                      <span>{format(task.completedAt, 'h:mm a')}</span>
                      <span className="sr-only"> completed</span>
                    </span>
                  ) : null}
                  {xp ? <span className={styles.xpTotal}>{formatXp(xp)}</span> : null}
                </>
              ) : due ? (
                <span className={styles.due} data-tone={due.tone}>
                  <CalendarDays size={13} aria-hidden="true" />
                  <span>{due.text}</span>
                  {due.tone === 'overdue' ? <span className="sr-only"> (overdue)</span> : null}
                </span>
              ) : null}
            </div>
          </div>

          <div className={styles.actions}>
            <TaskMenu
              task={task}
              panel={panel}
              onPanelChange={setPanel}
              onEdit={() => (canEditInPlace ? setEditing(true) : openTask(task.id))}
            />
          </div>

          {struck && motion && motion.xp > 0 ? (
            <span className={styles.xp} data-motion="opacity" aria-hidden="true">
              +{motion.xp} XP
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
})
