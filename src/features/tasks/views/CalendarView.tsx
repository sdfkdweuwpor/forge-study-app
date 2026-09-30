import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { format } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type TouchEvent as ReactTouchEvent,
} from 'react'
import { useNow } from '@/app/hooks/useNow'
import { useTheme } from '@/app/providers/ThemeProvider'
import type { HHmm, ID, ISODate, Task } from '@/db/types'
import {
  deadlinesByDay,
  dropTime,
  durationOf,
  hourMarks,
  minutesOfDay,
  nowOffset,
  startMinutesOf,
  tasksByDay,
  timeRangeFor,
  windowLabel,
  type PlacedTask,
  type Slot,
  type TimeRange,
} from '@/logic/calendarWeek'
import { fromISODate, parseHHmm } from '@/logic/dates'
import { planDay, planTime } from '@/logic/taskDates'
import { formatDayLong, formatTimeOfDay } from '@/logic/taskDisplay'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'
import { Kbd } from '@/ui/Kbd'
import { CalendarEventFace, DraggableEvent } from './CalendarEvent'
import styles from './Calendar.module.css'

export interface CalendarViewProps {
  /** Tasks after the view's filters; the calendar picks the ones on the days it shows. */
  tasks: readonly Task[]
  days: readonly ISODate[]
  today: ISODate
  selectedId: ID | null
  /** The selection was moved with the keyboard, so the selected task scrolls into view. */
  revealSelected: boolean
  onSelect: (id: ID) => void
  /** Moves a task to a day and time. Resolves false when the write failed. */
  onReschedule: (task: Task, slot: Slot) => Promise<boolean>
  /** Sets how long a block is, in minutes. Resolves false when the write failed. */
  onResize: (task: Task, minutes: number) => Promise<boolean>
  onShift: (direction: -1 | 1) => void
  onToday: () => void
}

/** All-day tasks shown per day before "+N more". */
const ALL_DAY_LIMIT = 3
/** How long the dropped position is kept after the write, so the live query has time to catch up. */
const SETTLE_MS = 180
const SWIPE_MIN_PX = 70

type Target = { day: ISODate; time: HHmm | null }

const collisionDetection: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args)
  return byPointer.length > 0 ? byPointer : rectIntersection(args)
}

function customProps(props: Record<string, number>): CSSProperties {
  return props as unknown as CSSProperties
}

interface AllDayCellProps {
  day: ISODate
  today: ISODate
  tasks: readonly Task[]
  over: boolean
  expanded: boolean
  onExpand: () => void
  selectedId: ID | null
  reveal: boolean
  onSelect: (id: ID) => void
}

/** A day's all-day strip: chips for tasks with a date and no time, and a drop target for "no time". */
function AllDayCell({
  day,
  today,
  tasks,
  over,
  expanded,
  onExpand,
  selectedId,
  reveal,
  onSelect,
}: AllDayCellProps) {
  const { setNodeRef } = useDroppable({ id: `allday:${day}`, data: { kind: 'allday', day } })
  const shown = expanded ? tasks : tasks.slice(0, ALL_DAY_LIMIT)
  const hidden = tasks.length - shown.length
  return (
    <ul
      ref={setNodeRef}
      className={styles.allDayCell}
      aria-label={`${formatDayLong(day, today)}, all day`}
      data-today={day === today || undefined}
      data-over={over || undefined}
    >
      {shown.map((task) => (
        <DraggableEvent
          key={task.id}
          className={styles.chip}
          task={task}
          variant="chip"
          day={day}
          selected={task.id === selectedId}
          reveal={reveal}
          onSelect={onSelect}
        />
      ))}
      {hidden > 0 ? (
        <li>
          <button type="button" className={styles.more} onClick={onExpand}>
            +{hidden} more
          </button>
        </li>
      ) : null}
    </ul>
  )
}

interface DayColumnProps {
  day: ISODate
  today: ISODate
  range: TimeRange
  placed: readonly PlacedTask[]
  ghost: { time: HHmm; minutes: number } | null
  nowMinutes: number | null
  selectedId: ID | null
  reveal: boolean
  onSelect: (id: ID) => void
  onResizePreview: (id: ID, minutes: number | null) => void
  onResizeCommit: (id: ID, minutes: number) => void
}

/** A day's timed column: blocks placed by time, the now line on today, and a drop target for "at this time". */
function DayColumn({
  day,
  today,
  range,
  placed,
  ghost,
  nowMinutes,
  selectedId,
  reveal,
  onSelect,
  onResizePreview,
  onResizeCommit,
}: DayColumnProps) {
  const { setNodeRef } = useDroppable({ id: `day:${day}`, data: { kind: 'day', day } })
  const line = day === today && nowMinutes !== null ? nowOffset(nowMinutes, range) : null
  return (
    <ul
      ref={setNodeRef}
      className={styles.col}
      aria-label={`${formatDayLong(day, today)}, scheduled`}
      data-timed-day={day}
      data-today={day === today || undefined}
    >
      {ghost ? (
        <li
          className={styles.ghost}
          aria-hidden="true"
          style={customProps({
            '--top': (parseHHmm(ghost.time) ?? range.start) / 60 - range.start / 60,
            '--span': ghost.minutes / 60,
          })}
        >
          <span>{formatTimeOfDay(ghost.time)}</span>
        </li>
      ) : null}
      {placed.map((p) => (
        <DraggableEvent
          key={p.task.id}
          className={styles.event}
          style={customProps({
            '--top': (p.start - range.start) / 60,
            '--span': (p.end - p.start) / 60,
            '--lane': p.lane,
            '--lanes': p.lanes,
          })}
          task={p.task}
          variant="block"
          span={{ start: p.start, end: p.end }}
          day={day}
          selected={p.task.id === selectedId}
          reveal={reveal}
          onSelect={onSelect}
          resize={{
            start: p.start,
            onPreview: (minutes) => onResizePreview(p.task.id, minutes),
            onCommit: (minutes) => onResizeCommit(p.task.id, minutes),
          }}
        />
      ))}
      {line !== null ? (
        <li
          className={styles.now}
          aria-hidden="true"
          style={customProps({ '--now': line / 60 })}
        />
      ) : null}
    </ul>
  )
}

/** Deadlines on a day, as small calm chips under its date ("Due: Pay phone bill"); amber only on the day itself. */
function DeadlineMarkers({
  day,
  today,
  tasks,
}: {
  day: ISODate
  today: ISODate
  tasks: readonly Task[]
}) {
  if (tasks.length === 0) return null
  const shown = tasks.slice(0, 2)
  const more = tasks.length - shown.length
  return (
    <ul className={styles.deadlines} aria-label={`Deadlines on ${formatDayLong(day, today)}`}>
      {shown.map((t) => (
        <li key={t.id} className={styles.deadline} data-today={day === today || undefined} title={`Due: ${t.title}${t.dueTime ? `, ${formatTimeOfDay(t.dueTime)}` : ''}`}>
          Due: {t.title}
        </li>
      ))}
      {more > 0 ? <li className={styles.deadline}>+{more} more due</li> : null}
    </ul>
  )
}

/**
 * The calendar: seven day columns (three on a phone) on a 07:00–23:00 grid, an all-day strip above,
 * today highlighted and a line for the current time. Drag a task to another day or time to
 * reschedule it (a scheduled task is pinned), drag a block's bottom edge to change its length, and drop
 * it in the untimed strip to clear its time. Deadlines are marked in the day header. From the keyboard,
 * select a task and use Alt+←/→ to shift a day and Alt+↑/↓ a quarter hour. On a phone, swipe or use
 * the arrows to move between windows of days.
 */
export function CalendarView({
  tasks,
  days,
  today,
  selectedId,
  revealSelected,
  onSelect,
  onReschedule,
  onResize,
  onShift,
  onToday,
}: CalendarViewProps) {
  const dndId = useId()
  const { reducedMotion } = useTheme()
  const now = useNow('minute')
  const [activeId, setActiveId] = useState<ID | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  /** The dropped position, shown at once and kept until the write has landed. */
  const [pending, setPending] = useState<{ id: ID; slot: Slot } | null>(null)
  const [expanded, setExpanded] = useState(false)
  /** A length being dragged (or just dropped, until the write has landed). */
  const [sizing, setSizing] = useState<{ id: ID; minutes: number } | null>(null)
  const settle = useRef(0)
  const dragging = useRef(false)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)

  const shown = useMemo(
    () =>
      pending || sizing
        ? tasks.map((t) => {
            let next = t
            if (pending && t.id === pending.id)
              next = { ...next, doDate: pending.slot.doDate, doTime: pending.slot.doTime }
            if (sizing && t.id === sizing.id) next = { ...next, durationMinutes: sizing.minutes }
            return next
          })
        : tasks,
    [tasks, pending, sizing],
  )
  const deadlines = useMemo(() => deadlinesByDay(tasks, days), [tasks, days])
  const byDay = useMemo(() => tasksByDay(shown, days), [shown, days])
  const range = useMemo(
    () => timeRangeFor(byDay.flatMap((d) => d.timed.map((p) => p.task))),
    [byDay],
  )
  const tasksById = useMemo(() => new Map(shown.map((t) => [t.id, t])), [shown])
  const activeTask = activeId ? tasksById.get(activeId) : undefined
  const onScreen = byDay.some((d) => d.allDay.length + d.timed.length > 0)
  const hours = (range.end - range.start) / 60
  const dayCount = days.length

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  )

  /** What a drag currently points at: a day's all-day strip, or a day and a snapped time. */
  function targetOf(event: Pick<DragMoveEvent, 'active' | 'over' | 'delta'>): Target | null {
    const over = event.over
    if (!over) return null
    const kind: unknown = over.data.current?.kind
    const dayValue: unknown = over.data.current?.day
    if (typeof dayValue !== 'string') return null
    const day: ISODate = dayValue
    if (kind === 'allday') return { day, time: null }
    // The block follows the pointer in the window, so its top is where the drag started plus the drag's
    // distance. The column is measured now, so a page that scrolled during the drag still reads true.
    const initialTop = event.active.rect.current.initial?.top
    const column = gridRef.current?.querySelector<HTMLElement>(`[data-timed-day="${day}"]`)
    if (kind !== 'day' || initialTop === undefined || !column) return null
    const rect = column.getBoundingClientRect()
    const pxPerMinute = rect.height / Math.max(1, range.end - range.start)
    return { day, time: dropTime(initialTop + event.delta.y - rect.top, pxPerMinute, range) }
  }

  function describeTarget(t: Target): string {
    return `${formatDayLong(t.day, today)}${t.time ? `, ${formatTimeOfDay(t.time)}` : ', all day'}`
  }

  function commitResize(id: ID, minutes: number) {
    const task = tasksById.get(id)
    if (!task) {
      setSizing(null)
      return
    }
    const token = (settle.current += 1)
    setSizing({ id, minutes })
    void onResize(task, minutes).then((ok) => {
      window.setTimeout(() => {
        if (settle.current === token) setSizing(null)
      }, ok ? SETTLE_MS : 0)
    })
  }

  function previewResize(id: ID, minutes: number | null) {
    setSizing(minutes === null ? null : { id, minutes })
  }

  function onDragStart({ active }: DragStartEvent) {
    dragging.current = true
    setActiveId(String(active.id))
  }

  function onDragMove(event: DragMoveEvent) {
    const next = targetOf(event)
    setTarget((prev) =>
      prev?.day === next?.day && prev?.time === next?.time ? prev : next,
    )
  }

  function finish() {
    setActiveId(null)
    setTarget(null)
    // A touch drag ends with a touchend that must not read as a swipe.
    window.setTimeout(() => {
      dragging.current = false
    }, 80)
  }

  function onDragEnd(event: DragEndEvent) {
    const task = tasksById.get(String(event.active.id))
    const drop = targetOf(event) ?? target
    finish()
    if (!task || !drop) return
    if (drop.day === task.doDate && drop.time === planTime(task)) return
    const slot: Slot = { doDate: drop.day, doTime: drop.time }
    const token = (settle.current += 1)
    setPending({ id: task.id, slot })
    void onReschedule(task, slot).then((ok) => {
      window.setTimeout(() => {
        if (settle.current === token) setPending(null)
      }, ok ? SETTLE_MS : 0)
    })
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${tasksById.get(String(active.id))?.title ?? 'task'}. Drop it on a day or a time.`,
    onDragOver: () => undefined,
    onDragEnd: ({ active }) => {
      const title = tasksById.get(String(active.id))?.title ?? 'task'
      return target ? `Moved ${title} to ${describeTarget(target)}.` : `${title} dropped. Nothing changed.`
    },
    onDragCancel: ({ active }) =>
      `Move cancelled. ${tasksById.get(String(active.id))?.title ?? 'task'} is where it was.`,
  }

  function onTouchStart(e: ReactTouchEvent) {
    const touch = e.touches.length === 1 ? e.touches[0] : undefined
    swipe.current = touch ? { x: touch.clientX, y: touch.clientY } : null
  }

  function onTouchEnd(e: ReactTouchEvent) {
    const start = swipe.current
    swipe.current = null
    const touch = e.changedTouches[0]
    if (!start || !touch || dragging.current) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.6) onShift(dx < 0 ? 1 : -1)
  }

  const ghost = useMemo(() => {
    if (!target || target.time === null || !activeTask) return null
    return { day: target.day, time: target.time, minutes: durationOf(activeTask) }
  }, [target, activeTask])

  const week = dayCount >= 7
  const windowName = week ? 'week' : 'days'
  const activeSpan =
    activeTask && startMinutesOf(activeTask) !== null
      ? {
          start: startMinutesOf(activeTask) ?? 0,
          end: (startMinutesOf(activeTask) ?? 0) + durationOf(activeTask),
        }
      : undefined

  return (
    <section
      className={styles.root}
      aria-label="Calendar"
      style={customProps({ '--days': dayCount, '--hours': hours })}
    >
      <div className={styles.toolbar}>
        <div className={styles.nav}>
          <IconButton
            label={`Previous ${windowName}`}
            shortcut="left"
            icon={<ChevronLeft />}
            onClick={() => onShift(-1)}
          />
          <IconButton
            label={`Next ${windowName}`}
            shortcut="right"
            icon={<ChevronRight />}
            onClick={() => onShift(1)}
          />
          <Button variant="secondary" size="sm" onClick={onToday}>
            Today <Kbd keys="t" size="sm" variant="plain" />
          </Button>
        </div>
        <h2 className={styles.range} aria-live="polite">
          {windowLabel(days)}
        </h2>
        <span className={styles.hint}>
          <Kbd keys="alt+left" size="sm" variant="plain" />
          <Kbd keys="alt+right" size="sm" variant="plain" />
          <span>move the selected task a day</span>
        </span>
      </div>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={finish}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'Select a task, then press Alt with the left or right arrow to move it a day, or Alt with the up or down arrow to move it a quarter hour.',
          },
        }}
      >
        {/* Swipe is a touch shortcut for the arrows; the buttons and keys above do the same. */}
        <div
          ref={gridRef}
          className={styles.grid}
          role="group"
          aria-label={`Tasks for ${windowLabel(days)}`}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className={`${styles.row} ${styles.head}`}>
            <span />
            {days.map((day) => (
              <div
                key={day}
                className={styles.dayHead}
                data-today={day === today || undefined}
                data-past={day < today || undefined}
              >
                <span className={styles.dow}>{format(fromISODate(day), 'EEE')}</span>
                <span className={styles.dom}>
                  {format(fromISODate(day), 'd')}
                  {day === today ? <span className="sr-only"> (today)</span> : null}
                </span>
                <DeadlineMarkers day={day} today={today} tasks={deadlines.get(day) ?? []} />
              </div>
            ))}
          </div>

          <div className={`${styles.row} ${styles.allDay}`}>
            <span className={styles.gutterLabel}>untimed</span>
            {byDay.map((d) => (
              <AllDayCell
                key={d.day}
                day={d.day}
                today={today}
                tasks={d.allDay}
                over={target !== null && target.time === null && target.day === d.day}
                expanded={expanded}
                onExpand={() => setExpanded(true)}
                selectedId={selectedId}
                reveal={revealSelected}
                onSelect={onSelect}
              />
            ))}
          </div>

          <div className={styles.bodyWrap}>
            {!onScreen ? (
              <p className={styles.quiet}>
                Nothing is scheduled {week ? 'this week' : 'on these days'}. Tasks with a date
                show up here.
              </p>
            ) : null}
            <div className={`${styles.row} ${styles.body}`}>
              <div className={styles.hours} aria-hidden="true">
                {hourMarks(range).map((minutes, i) => (
                  <span
                    key={minutes}
                    className={styles.hour}
                    data-first={i === 0 || undefined}
                    style={customProps({ '--i': i })}
                  >
                    {formatTimeOfDay(`${String(minutes / 60).padStart(2, '0')}:00`)}
                  </span>
                ))}
              </div>
              {byDay.map((d) => (
                <DayColumn
                  key={d.day}
                  day={d.day}
                  today={today}
                  range={range}
                  placed={d.timed}
                  ghost={
                    ghost && ghost.day === d.day
                      ? { time: ghost.time, minutes: ghost.minutes }
                      : null
                  }
                  nowMinutes={minutesOfDay(now)}
                  selectedId={selectedId}
                  reveal={revealSelected}
                  onSelect={onSelect}
                  onResizePreview={previewResize}
                  onResizeCommit={commitResize}
                />
              ))}
            </div>
          </div>
        </div>

        <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
          {activeTask ? (
            <div className={styles.overlay}>
              <CalendarEventFace
                preview
                task={activeTask}
                variant={activeSpan ? 'block' : 'chip'}
                {...(activeSpan ? { span: activeSpan } : {})}
                day={planDay(activeTask) ?? today}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  )
}
