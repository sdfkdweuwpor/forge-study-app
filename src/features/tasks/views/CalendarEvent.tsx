import { useDraggable } from '@dnd-kit/core'
import { useEffect, useRef, type CSSProperties } from 'react'
import type { ID, ISODate, Task } from '@/db/types'
import { toHHmm } from '@/logic/dates'
import { tagColor } from '@/logic/tagColor'
import { formatTimeOfDay } from '@/logic/taskDisplay'
import { Checkbox } from '@/ui/Checkbox'
import { useTaskActions, useTaskEnv } from '../TaskActions'
import { openTask } from '../taskUrls'
import styles from './Calendar.module.css'

/** A block this many minutes or longer has room for a second line with its time. */
const TIME_LINE_MIN_MINUTES = 40

export type EventVariant = 'block' | 'chip'

interface EventFaceProps {
  task: Task
  variant: EventVariant
  /** Where it starts and how long it runs, in minutes after midnight (blocks only). */
  span?: { start: number; end: number }
  day: ISODate
  selected?: boolean
  reveal?: boolean
  onSelect?: (id: ID) => void
  /** A drag preview: the same look, nothing to click or tab to. */
  preview?: boolean
}

function timeText(span: { start: number; end: number }): string {
  const start = formatTimeOfDay(toHHmm(span.start))
  const end = formatTimeOfDay(toHHmm(span.end))
  // "2 – 2:45 PM" reads better than "2 PM – 2:45 PM" when both are on the same side of noon.
  const [sHead, sSuffix] = start.split(' ')
  const [, eSuffix] = end.split(' ')
  return sSuffix === eSuffix ? `${sHead} – ${end}` : `${start} – ${end}`
}

/**
 * The look of a task on the calendar: a block on the time grid or a chip in the all-day strip, in the
 * colour of its course (or first tag). The round checkbox completes it; the rest of the block opens it.
 */
export function CalendarEventFace({
  task,
  variant,
  span,
  day,
  selected = false,
  reveal = false,
  onSelect,
  preview = false,
}: EventFaceProps) {
  const actions = useTaskActions()
  const { today, tagColors, projects } = useTaskEnv()
  const root = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (selected && reveal) root.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, reveal])

  const done = task.status === 'done'
  const course = task.milestoneId ? projects?.courseById.get(task.milestoneId) : undefined
  const colorKey = course?.code ?? task.tags[0]
  const color = colorKey ? tagColor(colorKey, tagColors) : 'gray'
  const showTime = variant === 'block' && span !== undefined
  const long = span !== undefined && span.end - span.start >= TIME_LINE_MIN_MINUTES
  const overdue = !done && day < today
  const when = span ? timeText(span) : 'all day'

  return (
    <div
      ref={root}
      className={styles.face}
      data-variant={variant}
      data-color={color}
      data-long={long || undefined}
      data-done={done || undefined}
      data-doing={task.status === 'doing' || undefined}
      data-overdue={overdue || undefined}
      data-selected={selected || undefined}
      data-priority={task.priority}
      data-preview={preview || undefined}
      onPointerDownCapture={preview ? undefined : () => onSelect?.(task.id)}
      onFocusCapture={preview ? undefined : () => onSelect?.(task.id)}
    >
      <button
        type="button"
        className={styles.open}
        tabIndex={preview ? -1 : 0}
        aria-label={`Open ${task.title}, ${when}${done ? ', done' : ''}${overdue ? ', overdue' : ''}`}
        onClick={() => openTask(task.id)}
      />
      <Checkbox
        variant="round"
        className={styles.check}
        aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${task.title}`}
        checked={done}
        tabIndex={preview ? -1 : undefined}
        onCheckedChange={() => actions.toggleComplete(task)}
      />
      <span className={styles.text}>
        <span className={styles.title}>{task.title}</span>
        {showTime && long && span ? <span className={styles.time}>{timeText(span)}</span> : null}
      </span>
    </div>
  )
}

interface DraggableEventProps extends Omit<EventFaceProps, 'preview'> {
  className: string
  style?: CSSProperties
}

/** A calendar face that can be picked up (by mouse, or a long press on touch) and dropped on a day or time. */
export function DraggableEvent({ className, style, ...face }: DraggableEventProps) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: face.task.id,
    data: { kind: 'task' },
  })
  return (
    <li
      ref={setNodeRef}
      className={className}
      style={style}
      data-dragging={isDragging || undefined}
      {...listeners}
    >
      <CalendarEventFace {...face} />
    </li>
  )
}
