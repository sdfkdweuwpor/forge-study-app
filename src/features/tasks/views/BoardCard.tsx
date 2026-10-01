import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useMemo } from 'react'
import type { ID, Task } from '@/db/types'
import { useTaskMotion, type TaskMotion } from '../TaskActions'
import { TaskRow } from '../TaskRow'
import styles from './Board.module.css'

interface BoardCardProps {
  task: Task
  selected: boolean
  reveal: boolean
  onSelect: (id: ID) => void
}

/**
 * On a board a finished card joins Done at once, so it has no slide-out: the completion motion keeps
 * its checkbox fill, strike-through and "+15 XP", and never reaches `leaving`.
 */
export function boardMotion(motion: TaskMotion | undefined): TaskMotion | undefined {
  return motion && motion.phase === 'leaving' ? { ...motion, phase: 'struck' } : motion
}

/**
 * A card in a column: a `TaskRow` in its card form, draggable by pointer anywhere, and by keyboard
 * from its grip (focus it, Space to pick up, arrows to move, Space to drop, Esc to cancel).
 */
export function BoardCard({ task, selected, reveal, onSelect }: BoardCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })
  const motion = useTaskMotion().get(task.id)
  const held = useMemo(() => boardMotion(motion), [motion])

  return (
    <li
      ref={setNodeRef}
      className={styles.card}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-dragging={isDragging || undefined}
      {...listeners}
    >
      <TaskRow
        variant="card"
        task={task}
        selected={selected}
        reveal={reveal}
        onSelect={onSelect}
        motion={held}
        dragging={false}
        handle={
          <button
            ref={setActivatorNodeRef}
            type="button"
            className={styles.grip}
            data-drag-through=""
            aria-label={`Move ${task.title}`}
            {...attributes}
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
        }
      />
    </li>
  )
}
