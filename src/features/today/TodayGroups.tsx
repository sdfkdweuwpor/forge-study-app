import { CalendarArrowUp, ChevronRight } from 'lucide-react'
import { useId } from 'react'
import type { ID, Task } from '@/db/types'
import { formatXp } from '@/logic/taskDisplay'
import { Button } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'
import { TaskRow, useTaskMotion } from '@/features/tasks'
import styles from './TodayGroups.module.css'

/** One row of a group: the task, and words to show in place of its due date. */
export interface GroupItem {
  task: Task
  /** "3 days overdue" for a rolled-over task. */
  dueText?: string
}

interface Selection {
  selectedId: ID | null
  onSelect: (id: ID) => void
  /** The selection was moved with the keyboard, so the selected row scrolls into view. */
  reveal: boolean
}

interface RowsProps extends Selection {
  items: readonly GroupItem[]
  xpByTask?: ReadonlyMap<ID, number> | undefined
}

function Rows({ items, selectedId, onSelect, reveal, xpByTask }: RowsProps) {
  const motion = useTaskMotion()
  return (
    <ul className={styles.list}>
      {items.map(({ task, dueText }) => (
        <li key={task.id} className={styles.item}>
          <TaskRow
            task={task}
            selected={task.id === selectedId}
            reveal={reveal}
            onSelect={onSelect}
            motion={motion.get(task.id)}
            dueText={dueText}
            xp={xpByTask?.get(task.id)}
          />
        </li>
      ))}
    </ul>
  )
}

interface GroupProps extends RowsProps {
  id: 'fromGoals' | 'yours' | 'rolledOver'
  label: string
}

/** A titled group of today's tasks: "From your goals", "Your tasks". */
export function TaskGroup({ id, label, items, ...rest }: GroupProps) {
  const headingId = useId()
  return (
    <section className={styles.group} data-group={id} aria-labelledby={headingId}>
      <h2 className={styles.header} id={headingId}>
        <span>{label}</span>
        <span className={styles.count}>{items.length}</span>
      </h2>
      <Rows items={items} {...rest} />
    </section>
  )
}

interface RolledOverProps extends RowsProps {
  onMoveAll: () => void
}

/** Tasks that slipped from earlier days: amber header, days overdue on each row, one-click "Move all to today". */
export function RolledOverGroup({ items, onMoveAll, ...rest }: RolledOverProps) {
  const headingId = useId()
  return (
    <section className={styles.group} data-group="rolledOver" aria-labelledby={headingId}>
      <div className={styles.headerRow}>
        <h2 className={styles.header} id={headingId}>
          <span>Rolled over</span>
          <span className={styles.count}>{items.length}</span>
        </h2>
        <Tooltip content="Move every rolled-over task to today" shortcut="shift+t">
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<CalendarArrowUp />}
            aria-keyshortcuts="Shift+T"
            onClick={onMoveAll}
          >
            Move all to today
          </Button>
        </Tooltip>
      </div>
      <Rows items={items} {...rest} />
    </section>
  )
}

interface CompletedProps extends Selection {
  tasks: readonly Task[]
  xpByTask: ReadonlyMap<ID, number> | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Finished today, collapsed until asked for. The header carries the count and the XP it earned. */
export function CompletedGroup({ tasks, xpByTask, open, onOpenChange, ...rest }: CompletedProps) {
  const listId = useId()
  const headingId = useId()
  const totalXp = tasks.reduce((sum, t) => sum + (xpByTask?.get(t.id) ?? 0), 0)

  return (
    <section className={styles.group} data-group="completed" aria-labelledby={headingId}>
      <h2 className={styles.header} id={headingId}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => onOpenChange(!open)}
        >
          <ChevronRight className={styles.chevron} size={14} aria-hidden="true" />
          <span>Completed today</span>
          <span className={styles.count}>{tasks.length}</span>
          {totalXp > 0 ? <span className={styles.xp}>{formatXp(totalXp)}</span> : null}
        </button>
      </h2>
      <div id={listId} hidden={!open}>
        {open ? (
          <Rows items={tasks.map((task) => ({ task }))} xpByTask={xpByTask} {...rest} />
        ) : null}
      </div>
    </section>
  )
}
