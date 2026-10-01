import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useId, type ReactNode } from 'react'
import type { ID, Task } from '@/db/types'
import { columnKey, columnLabel, type BoardColumnId } from '@/logic/boardColumns'
import { BoardCard } from './BoardCard'
import styles from './Board.module.css'

const EMPTY_COPY: Record<BoardColumnId, string> = {
  todo: 'Nothing waiting. Add a task, or drag one back from Doing.',
  doing: 'Drag a task here when you start it.',
  done: 'Finished tasks land here, newest first.',
}

interface BoardColumnProps {
  id: BoardColumnId
  /** The cards to draw, in order (already resolved from the drag state). */
  tasks: readonly Task[]
  /** Something is being dragged and it is in this column. */
  target: boolean
  selectedId: ID | null
  reveal: boolean
  onSelect: (id: ID) => void
  footer?: ReactNode
}

/** One column: its header with the count, and a droppable, sortable stack of cards. */
export function BoardColumn({
  id,
  tasks,
  target,
  selectedId,
  reveal,
  onSelect,
  footer,
}: BoardColumnProps) {
  const headingId = useId()
  const { setNodeRef } = useDroppable({ id: columnKey(id) })
  return (
    <section className={styles.column} aria-labelledby={headingId} data-column={id}>
      <div className={styles.header}>
        <h2 id={headingId}>{columnLabel(id)}</h2>
        <span className={styles.count}>{tasks.length}</span>
      </div>
      <SortableContext
        id={id}
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul ref={setNodeRef} className={styles.cards} data-target={target || undefined}>
          {tasks.map((task) => (
            <BoardCard
              key={task.id}
              task={task}
              selected={task.id === selectedId}
              reveal={reveal}
              onSelect={onSelect}
            />
          ))}
          {tasks.length === 0 ? <li className={styles.empty}>{EMPTY_COPY[id]}</li> : null}
          {footer ? <li className={styles.footer}>{footer}</li> : null}
        </ul>
      </SortableContext>
    </section>
  )
}
