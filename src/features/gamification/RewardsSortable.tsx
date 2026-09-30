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
import { useId, type CSSProperties, type ReactNode } from 'react'
import type { ID } from '@/db/types'
import styles from './RewardsSortable.module.css'

/** Rows move up and down only. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

export interface RewardsRowState {
  /** The `⋮⋮` drag handle: drag with a pointer, or focus it and use Space, the arrows, Space. */
  handle: ReactNode
  dragging: boolean
}

interface ListProps<T extends { id: ID }> {
  items: readonly T[]
  /** All ids in their new order, after a drop. */
  onReorder: (ids: ID[]) => void
  /** What a row is called in screen-reader announcements: "30 min gaming". */
  nameOf: (item: T) => string
  renderRow: (item: T, state: RewardsRowState) => ReactNode
  'aria-label': string
}

function Row<T extends { id: ID }>({
  item,
  name,
  renderRow,
}: {
  item: T
  name: string
  renderRow: ListProps<T>['renderRow']
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  return (
    <li
      ref={setNodeRef}
      className={styles.row}
      style={style}
      data-dragging={isDragging || undefined}
    >
      {renderRow(item, {
        dragging: isDragging,
        handle: (
          <button
            ref={setActivatorNodeRef}
            type="button"
            className={styles.grip}
            aria-label={`Reorder ${name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
        ),
      })}
    </li>
  )
}

/**
 * A vertically sortable list with a keyboard-operable handle per row. It owns no data: it reports the
 * new order of ids after a drop and the caller writes it.
 */
export function RewardsSortable<T extends { id: ID }>({
  items,
  onReorder,
  nameOf,
  renderRow,
  'aria-label': ariaLabel,
}: ListProps<T>) {
  const dndId = useId()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const names = new Map(items.map((i) => [i.id, nameOf(i)]))
  const nameFor = (id: string | number): string => names.get(String(id)) ?? 'reward'

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const ids = items.map((i) => i.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    onReorder(arrayMove(ids, from, to))
  }

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
          onDragStart: ({ active }) => `Picked up ${nameFor(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over ? `${nameFor(active.id)} is over ${nameFor(over.id)}.` : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? `Dropped ${nameFor(active.id)} over ${nameFor(over.id)}.`
              : `Dropped ${nameFor(active.id)}.`,
          onDragCancel: ({ active }) =>
            `Reordering cancelled. ${nameFor(active.id)} is back where it was.`,
        },
      }}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className={styles.list} aria-label={ariaLabel}>
          {items.map((item) => (
            <Row key={item.id} item={item} name={nameFor(item.id)} renderRow={renderRow} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
