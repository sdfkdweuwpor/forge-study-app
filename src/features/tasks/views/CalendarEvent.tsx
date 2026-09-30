import { useDraggable } from '@dnd-kit/core'
import {
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { ID, ISODate, Task } from '@/db/types'
import { resizedMinutes } from '@/logic/calendarWeek'
import { toHHmm } from '@/logic/dates'
import { tagColor } from '@/logic/tagColor'
import { formatTimeOfDay } from '@/logic/taskDisplay'
import { Checkbox } from '@/ui/Checkbox'
import { useTaskActions, useTaskEnv } from '../TaskActions'
import { openTask } from '../taskUrls'
import styles from './Calendar.module.css'

/** A block this many minutes or longer has room for a two-line title, and for its time under that. */
const TWO_LINES_MIN_MINUTES = 40
const TIME_LINE_MIN_MINUTES = 58

export type EventVariant = 'block' | 'chip'

/**
 * Moving a task to another day remounts its block, which drops keyboard focus. The nudge that caused it
 * asks for focus back here, and the block that mounts for that task takes it.
 */
let refocusId: ID | null = null
export function refocusEvent(id: ID): void {
  const active = document.activeElement
  if (active === document.body || active?.closest('[data-calendar-face]')) refocusId = id
}

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
  const open = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (preview || refocusId !== task.id) return
    refocusId = null
    open.current?.focus({ preventScroll: true })
  }, [preview, task.id])

  useEffect(() => {
    if (selected && reveal) root.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, reveal])

  const done = task.status === 'done'
  const course = task.milestoneId ? projects?.courseById.get(task.milestoneId) : undefined
  const goal = task.goalId ? projects?.goalById.get(task.goalId) : undefined
  // Quiet colour by goal: a plan session (or anything filed under a goal or course) takes its course's or
  // goal's colour. Everyday tasks stay neutral, however they are tagged.
  const colorKey = course?.code ?? goal?.title ?? null
  const color =
    colorKey && (task.kind !== 'task' || task.goalId !== null || course)
      ? tagColor(colorKey, tagColors)
      : 'gray'
  const showTime = variant === 'block' && span !== undefined
  const minutes = span ? span.end - span.start : 0
  const long = minutes >= TWO_LINES_MIN_MINUTES
  const roomForTime = minutes >= TIME_LINE_MIN_MINUTES
  // Planned for a day that has passed and still open: carried over (said plainly, no alarm).
  const overdue = !done && day < today
  const when = span ? timeText(span) : 'all day'

  return (
    <div
      ref={root}
      className={styles.face}
      data-calendar-face=""
      data-variant={variant}
      data-color={color}
      data-long={long || undefined}
      data-done={done || undefined}
      data-doing={task.status === 'doing' || undefined}
      data-overdue={overdue || undefined}
      data-selected={selected || undefined}
      data-priority={task.priority}
      data-kind={task.kind}
      data-preview={preview || undefined}
      onPointerDownCapture={preview ? undefined : () => onSelect?.(task.id)}
      onFocusCapture={preview ? undefined : () => onSelect?.(task.id)}
    >
      <button
        ref={open}
        type="button"
        className={styles.open}
        tabIndex={preview ? -1 : 0}
        aria-label={`Open ${task.title}, ${when}${done ? ', done' : ''}${overdue ? ', carried over' : ''}`}
        onClick={() => openTask(task.id)}
      />
      <Checkbox
        variant="round"
        className={styles.check}
        aria-label={`Done: ${task.title}`}
        checked={done}
        tabIndex={preview ? -1 : undefined}
        onCheckedChange={() => actions.toggleComplete(task)}
      />
      <span className={styles.text}>
        <span className={styles.title}>{task.title}</span>
        {showTime && roomForTime && span ? (
          <span className={styles.time}>{timeText(span)}</span>
        ) : null}
      </span>
    </div>
  )
}

interface ResizeProps {
  /** Minutes after midnight the block starts. */
  start: number
  /** Live length while the edge is dragged; `null` when the drag ends or is cancelled. */
  onPreview: (minutes: number | null) => void
  onCommit: (minutes: number) => void
}

interface DraggableEventProps extends Omit<EventFaceProps, 'preview'> {
  className?: string | undefined
  style?: CSSProperties
  /** Blocks only: a grip on the bottom edge that changes the length (quarter hours). */
  resize?: ResizeProps
}

/** The bottom-edge grip: drag to change the length. It never starts a move (mouse and touch are stopped here). */
function ResizeGrip({
  resize,
  task,
  span,
}: {
  resize: ResizeProps
  task: Task
  span: { start: number; end: number }
}) {
  const drag = useRef<{ y: number; base: number; ppm: number; last: number } | null>(null)
  const base = span.end - span.start

  function down(e: ReactPointerEvent<HTMLSpanElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const column = e.currentTarget.closest('[data-timed-day]')
    const hourPx = column
      ? Number.parseFloat(getComputedStyle(column).getPropertyValue('--hour-h'))
      : 64
    drag.current = {
      y: e.clientY,
      base,
      ppm: (Number.isFinite(hourPx) && hourPx > 0 ? hourPx : 64) / 60,
      last: base,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function move(e: ReactPointerEvent<HTMLSpanElement>) {
    const d = drag.current
    if (!d) return
    const minutes = resizedMinutes(resize.start, d.base, e.clientY - d.y, d.ppm)
    if (minutes !== d.last) {
      d.last = minutes
      resize.onPreview(minutes)
    }
  }

  function up() {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.last !== d.base) resize.onCommit(d.last)
    else resize.onPreview(null)
  }

  function cancel() {
    if (!drag.current) return
    drag.current = null
    resize.onPreview(null)
  }

  return (
    <span
      className={styles.grip}
      aria-hidden="true"
      data-testid="resize-grip"
      data-task={task.id}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    />
  )
}

/** A calendar face that can be picked up (by mouse, or a long press on touch) and dropped on a day or time. */
export function DraggableEvent({ className, style, resize, ...face }: DraggableEventProps) {
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
      {resize && face.span ? (
        <ResizeGrip resize={resize} task={face.task} span={face.span} />
      ) : null}
    </li>
  )
}
