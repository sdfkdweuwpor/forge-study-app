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
import { useId, useMemo } from 'react'
import type { ID, Task } from '@/db/types'
import type { TaskGroup } from '@/logic/taskQuery'
import { TaskRow } from './TaskRow'
import { useTaskMotion, type TaskMotion } from './TaskActions'
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
  motion: TaskMotion | undefined
}

function SortableRow({ task, selected, reveal, onSelect, showCourse, motion }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })
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
        handle={
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
        }
      />
    </li>
  )
}

/**
 * Grouped task rows. When `reorderable`, each group is a sortable list: drag by the `⋮⋮` handle with
 * a pointer, or focus it and use Space, the arrow keys and Space again. Dragging never crosses groups.
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
  const motion = useTaskMotion()
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

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const group = groups.find((g) => g.tasks.some((t) => t.id === active.id))
    if (!group?.tasks.some((t) => t.id === over.id)) return
    const ids = group.tasks.map((t) => t.id)
    const moved = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    const at = moved.indexOf(String(active.id))
    onReorder(String(active.id), moved[at - 1] ?? null, moved[at + 1] ?? null)
  }

  const sections = groups.map((group) => {
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
            <SortableContext
              items={group.tasks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {group.tasks.map((task) => (
                <SortableRow
                  key={task.id}
                  task={task}
                  selected={task.id === selectedId}
                  reveal={revealSelected}
                  onSelect={onSelect}
                  showCourse={showCourse}
                  motion={motion.get(task.id)}
                />
              ))}
            </SortableContext>
          ) : (
            group.tasks.map((task) => (
              <li key={task.id} className={styles.item}>
                <TaskRow
                  task={task}
                  selected={task.id === selectedId}
                  reveal={revealSelected}
                  onSelect={onSelect}
                  showCourse={showCourse}
                  motion={motion.get(task.id)}
                  xp={xpByTask?.get(task.id)}
                />
              </li>
            ))
          )}
        </ul>
      </section>
    )
  })

  if (!reorderable) return <div className={styles.root}>{sections}</div>

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
          onDragCancel: ({ active }) => `Reordering cancelled. ${titleOf(active.id)} is back where it was.`,
        },
      }}
    >
      <div className={styles.root}>{sections}</div>
    </DndContext>
  )
}
