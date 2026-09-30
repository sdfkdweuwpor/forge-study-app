import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ID, Task } from '@/db/types'
import { LIST_PAGE, LIST_STEP, indexAcross, rowsToDraw, takePerGroup } from '@/logic/progressiveList'
import type { TaskGroup } from '@/logic/taskQuery'
import { Button } from '@/ui/Button'
import { TaskRow } from './TaskRow'
import { useRowMotion } from './TaskActions'
import styles from './TaskList.module.css'

/** Rows move up and down only. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

export interface TaskListProps {
  groups: readonly TaskGroup[]
  /** Rows can be dragged (and moved with Alt+↑/↓) within their group. */
  reorderable: boolean
  selectedId: ID | null
  onSelect: (id: ID) => void
  /** Called after a drag: the moved task and the two neighbours it now sits between, within its group. */
  onReorder: (id: ID, above: ID | null, below: ID | null) => void
  showCourse?: boolean
  /** XP earned per finished task, for the Completed list. */
  xpByTask?: ReadonlyMap<ID, number>
  /** The selection was moved with the keyboard, so the selected row scrolls into view. */
  revealSelected?: boolean
}

interface SortableRowProps {
  task: Task
  selected: boolean
  reveal: boolean
  onSelect: (id: ID) => void
  showCourse: boolean
}

/** A row that is not draggable. It follows its own completion motion, so the list stays put. */
const PlainRow = memo(function PlainRow({
  task,
  selected,
  reveal,
  onSelect,
  showCourse,
  xp,
}: SortableRowProps & { xp: number | undefined }) {
  const motion = useRowMotion(task.id)
  return (
    <li className={styles.item}>
      <TaskRow
        task={task}
        selected={selected}
        reveal={reveal}
        onSelect={onSelect}
        showCourse={showCourse}
        motion={motion}
        xp={xp}
      />
    </li>
  )
})

const SortableRow = memo(function SortableRow({
  task,
  selected,
  reveal,
  onSelect,
  showCourse,
}: SortableRowProps) {
  const motion = useRowMotion(task.id)
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })
  // The handle is a prop of the memoised row: a new element on every render would redraw every row
  // whenever the sortable context moves (any change to the list).
  const handle = useMemo(
    () => (
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={styles.grip}
        aria-label={`Reorder ${task.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>
    ),
    [setActivatorNodeRef, task.title, attributes, listeners],
  )
  return (
    <li
      ref={setNodeRef}
      className={styles.item}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-dragging={isDragging || undefined}
    >
      <TaskRow
        task={task}
        selected={selected}
        reveal={reveal}
        onSelect={onSelect}
        motion={motion}
        showCourse={showCourse}
        dragging={isDragging}
        handle={handle}
      />
    </li>
  )
})

/**
 * "Showing 100 of 2,000" and a button for more; the next rows also come on their own as this footer
 * nears the viewport, so scrolling never meets an end that is not the list's.
 */
function MoreRows({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const more = useRef(onMore)
  useEffect(() => {
    more.current = onMore
  })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    // A new observer each time rows are added: it reports at once, so a footer still in view asks again.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) more.current()
      },
      { rootMargin: '0px 0px 800px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [shown])
  const next = Math.min(LIST_STEP, total - shown)
  return (
    <div ref={ref} className={styles.more}>
      <span>
        Showing {shown.toLocaleString('en-US')} of {total.toLocaleString('en-US')}
      </span>
      <Button variant="ghost" size="sm" onClick={onMore}>
        Show {next.toLocaleString('en-US')} more
      </Button>
    </div>
  )
}

/**
 * Grouped task rows. When `reorderable`, each group is a sortable list: drag by the `⋮⋮` handle with
 * a pointer, or focus it and use Space, the arrow keys and Space again. Dragging never crosses groups.
 * A long list draws its first rows and the rest as it is scrolled (`progressiveList`); group headers
 * still count every task, and the keyboard selection is always drawn. Give the list a `key` per list
 * shown, so another list starts from its first rows again.
 */
export function TaskList({
  groups,
  reorderable,
  selectedId,
  onSelect,
  onReorder,
  showCourse = true,
  xpByTask,
  revealSelected = false,
}: TaskListProps) {
  const dndId = useId()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const titles = useMemo(() => {
    const map = new Map<string, string>()
    for (const group of groups) for (const task of group.tasks) map.set(task.id, task.title)
    return map
  }, [groups])
  const titleOf = (id: string | number): string => titles.get(String(id)) ?? 'task'

  const [limit, setLimit] = useState(LIST_PAGE)
  const total = useMemo(() => groups.reduce((n, g) => n + g.tasks.length, 0), [groups])
  const selectedAt = useMemo(() => indexAcross(groups, selectedId), [groups, selectedId])
  const shown = rowsToDraw(total, limit, selectedAt)
  const perGroup = takePerGroup(
    groups.map((g) => g.tasks.length),
    shown,
  )
  const showMore = () => setLimit(Math.max(limit, shown) + LIST_STEP)

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const group = groups.find((g) => g.tasks.some((t) => t.id === active.id))
    if (!group?.tasks.some((t) => t.id === over.id)) return
    const ids = group.tasks.map((t) => t.id)
    const moved = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    const at = moved.indexOf(String(active.id))
    onReorder(String(active.id), moved[at - 1] ?? null, moved[at + 1] ?? null)
  }

  const sections = groups.map((group, i) => {
    const take = perGroup[i] ?? 0
    // A group the drawn rows have not reached yet is left out (an empty group still shows its header).
    if (take === 0 && group.tasks.length > 0) return null
    const rows = take === group.tasks.length ? group.tasks : group.tasks.slice(0, take)
    const headingId = `${dndId}-${group.id}`
    return (
      <section
        key={group.id}
        className={styles.group}
        data-group={group.id}
        aria-labelledby={group.label ? headingId : undefined}
      >
        {group.label ? (
          <h2 className={styles.groupHeader} id={headingId}>
            <span>{group.label}</span>
            <span className={styles.count}>{group.tasks.length}</span>
          </h2>
        ) : null}
        <ul className={styles.list}>
          {reorderable ? (
            <SortableContext items={rows.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {rows.map((task) => (
                <SortableRow
                  key={task.id}
                  task={task}
                  selected={task.id === selectedId}
                  reveal={revealSelected}
                  onSelect={onSelect}
                  showCourse={showCourse}
                />
              ))}
            </SortableContext>
          ) : (
            rows.map((task) => (
              <PlainRow
                key={task.id}
                task={task}
                selected={task.id === selectedId}
                reveal={revealSelected}
                onSelect={onSelect}
                showCourse={showCourse}
                xp={xpByTask?.get(task.id)}
              />
            ))
          )}
        </ul>
      </section>
    )
  })

  const more =
    shown < total ? <MoreRows shown={shown} total={total} onMore={showMore} /> : null

  if (!reorderable)
    return (
      <div className={styles.root}>
        {sections}
        {more}
      </div>
    )

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'To reorder, press Space or Enter on the handle, move with the arrow keys, then press Space or Enter to drop. Press Escape to cancel.',
        },
        announcements: {
          onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over ? `${titleOf(active.id)} is over ${titleOf(over.id)}.` : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? `Dropped ${titleOf(active.id)} over ${titleOf(over.id)}.`
              : `Dropped ${titleOf(active.id)}.`,
          onDragCancel: ({ active }) =>
            `Reordering cancelled. ${titleOf(active.id)} is back where it was.`,
        },
      }}
    >
      <div className={styles.root}>
        {sections}
        {more}
      </div>
    </DndContext>
  )
}
