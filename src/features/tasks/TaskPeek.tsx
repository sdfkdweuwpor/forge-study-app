import { Copy, Maximize2, Trash2, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { navigate } from '@/app/router'
import { useTask } from '@/db/hooks/useTasks'
import type { ID } from '@/db/types'
import { IconButton } from '@/ui/IconButton'
import { Skeleton } from '@/ui/Skeleton'
import { TaskDetail } from './TaskDetail'
import { useTaskActions } from './TaskActions'
import styles from './TaskPeek.module.css'

interface TaskPeekProps {
  taskId: ID
  onClose: () => void
  /** Bump to move focus to the tags field. */
  focusTagsNonce?: number
}

/**
 * The right-hand peek panel (desktop and tablet): the whole task beside the list, so triage never
 * loses your place. It floats over the page like Notion's side peek, is dismissed with Esc or ✕, and
 * opens the task as a page with the expand button. Rendered into <body> so it is not affected by the
 * page's own transitions.
 */
export function TaskPeek({ taskId, onClose, focusTagsNonce = 0 }: TaskPeekProps) {
  const task = useTask(taskId)
  const actions = useTaskActions()
  const panel = useRef<HTMLElement | null>(null)

  // Focus moves into the panel when it opens and goes back to where it came from when it closes.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = panel.current
    node?.focus({ preventScroll: true })
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || node?.contains(active)) {
        if (before && document.contains(before)) before.focus({ preventScroll: true })
      }
    }
  }, [])

  // A task that is trashed or deleted elsewhere takes its panel with it.
  const missing = task === null
  useEffect(() => {
    if (missing) onClose()
  }, [missing, onClose])

  return createPortal(
    <aside
      ref={panel}
      className={styles.panel}
      aria-label="Task details"
      tabIndex={-1}
      data-motion="opacity"
    >
      <header className={styles.bar}>
        <IconButton label="Close" shortcut="esc" icon={<X />} onClick={onClose} tooltipSide="bottom" />
        <IconButton
          label="Open as page"
          icon={<Maximize2 />}
          onClick={() => navigate('task', { taskId })}
          tooltipSide="bottom"
        />
        <span className={styles.spacer} />
        {task ? (
          <>
            <IconButton
              label="Duplicate"
              icon={<Copy />}
              onClick={() => void actions.duplicate(task.id)}
              tooltipSide="bottom"
            />
            <IconButton
              label="Move to trash"
              shortcut="mod+backspace"
              icon={<Trash2 />}
              onClick={() => {
                actions.trash(task)
                onClose()
              }}
              tooltipSide="bottom"
            />
          </>
        ) : null}
      </header>
      <div className={styles.body}>
        {task ? (
          <TaskDetail task={task} variant="peek" focusTagsNonce={focusTagsNonce} onDeleted={onClose} />
        ) : (
          <div className={styles.loading} role="status" aria-busy="true" aria-label="Loading task">
            <Skeleton width="70%" height={28} variant="block" />
            <Skeleton lines={4} />
          </div>
        )}
      </div>
    </aside>,
    document.body,
  )
}
