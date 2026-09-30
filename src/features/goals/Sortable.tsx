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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useId, type CSSProperties, type ReactNode } from 'react'
import { moveItem } from '@/logic/goalDraft'
import { cx } from '@/ui/internal/cx'
import styles from './Sortable.module.css'

/** Rows move up and down only. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

export interface SortableRowState {
  /** The `⋮⋮` drag handle: drag with a pointer, or focus it and use Space, the arrows, Space. */
  handle: ReactNode
  dragging: boolean
}

export interface SortableListProps<T extends { id: string }> {
  items: readonly T[]
  /** Called with all ids in their new order after a drop. */
  onReorder: (ids: string[]) => void
  /** What a row is called in screen-reader announcements and on its handle: "C182 Introduction to IT". */
  nameOf: (item: T) => string
  renderRow: (item: T, state: SortableRowState) => ReactNode
  /** Element for the list and for each row. Defaults to `ul` / `li`. */
  as?: 'ul' | 'div'
  rowAs?: 'li' | 'div'
  role?: string
  rowRole?: string
  className?: string
  rowClassName?: string
  'aria-label'?: string
}

interface RowProps<T extends { id: string }> {
  item: T
  name: string
  as: 'li' | 'div'
  role: string | undefined
  className: string | undefined
  renderRow: SortableListProps<T>['renderRow']
}

function SortableRow<T extends { id: string }>({
  item,
  name,
  as: Tag,
  role,
  className,
  renderRow,
}: RowProps<T>) {
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
    <Tag
      ref={setNodeRef as never}
      role={role}
      className={cx(styles.row, className)}
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
    </Tag>
  )
}

/**
 * A vertically sortable list with a keyboard-operable handle per row. The list owns no data: it
 * reports the new order of ids and the caller writes it (and Undo, if it wants one).
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  nameOf,
  renderRow,
  as: ListTag = 'ul',
  rowAs = 'li',
  role,
  rowRole,
  className,
  rowClassName,
  'aria-label': ariaLabel,
}: SortableListProps<T>) {
  const dndId = useId()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const names = new Map(items.map((i) => [i.id, nameOf(i)]))
  const nameFor = (id: string | number): string => names.get(String(id)) ?? 'item'

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const ids = items.map((i) => i.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    onReorder(moveItem(ids, from, to))
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
        <ListTag role={role} className={cx(styles.list, className)} aria-label={ariaLabel}>
          {items.map((item) => (
            <SortableRow
              key={item.id}
              item={item}
              name={nameFor(item.id)}
              as={rowAs}
              role={rowRole}
              className={rowClassName}
              renderRow={renderRow}
            />
          ))}
        </ListTag>
      </SortableContext>
    </DndContext>
  )
}
