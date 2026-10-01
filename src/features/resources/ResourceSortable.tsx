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
import styles from './ResourceSortable.module.css'

/** Rows move up and down only. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

export interface SortableRowState {
  /** The `⋮⋮` handle: drag it with a pointer, or focus it and press Space, the arrows, then Space. */
  handle: ReactNode
  dragging: boolean
}

interface ListProps<T extends { id: ID }> {
  items: readonly T[]
  /** All ids in their new order, after a drop. */
  onReorder: (ids: ID[]) => void
  /** What a row is called in announcements and on its handle: "MDN: CSS grid". */
  nameOf: (item: T) => string
  renderRow: (item: T, state: SortableRowState) => ReactNode
  /** Attributes for each `li` (a test id, a data attribute the panel scrolls to). */
  rowProps?: (item: T) => Record<string, string | undefined>
  'aria-label': string
}

function Row<T extends { id: ID }>({
  item,
  name,
  extra,
  renderRow,
}: {
  item: T
  name: string
  extra: Record<string, string | undefined>
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
      {...extra}
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
 * A vertically sortable list with a keyboard-operable handle on every row (Space or Enter picks a row up,
 * the arrows move it, Space or Enter drops it, Escape cancels; each step is announced). It owns no data:
 * it reports the new order of ids and the caller writes it.
 */
export function ResourceSortable<T extends { id: ID }>({
  items,
  onReorder,
  nameOf,
  renderRow,
  rowProps,
  'aria-label': ariaLabel,
}: ListProps<T>) {
  const dndId = useId()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const names = new Map(items.map((i) => [i.id, nameOf(i)]))
  const nameFor = (id: string | number): string => names.get(String(id)) ?? 'resource'

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
            <Row
              key={item.id}
              item={item}
              name={nameFor(item.id)}
              extra={rowProps?.(item) ?? {}}
              renderRow={renderRow}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
