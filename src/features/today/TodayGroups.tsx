import { CalendarArrowUp, ChevronRight } from 'lucide-react'
import { useId } from 'react'
import type { ID, Task } from '@/db/types'
import { formatTimeOfDay, formatXp } from '@/logic/taskDisplay'
import { planTime } from '@/logic/taskDates'
import { Button } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'
import { TaskRow, useTaskMotion } from '@/features/tasks'
import { startFocus } from './startFocus'
import styles from './TodayGroups.module.css'

/** One row of a group: the task, and words to show in place of its date. */
export interface GroupItem {
  task: Task
  /** "from Tue" for a carried-over task. */
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
  /** The one-list view: a time gutter beside each row (the planned start, blank when untimed). */
  showTime?: boolean
  /** The day the list is for; the gutter shows a time only for a task planned on it. */
  today?: string
}

function Rows({
  items,
  selectedId,
  onSelect,
  reveal,
  xpByTask,
  showTime = false,
  today,
}: RowsProps) {
  const motion = useTaskMotion()
  return (
    <ul className={styles.list} data-timed={showTime || undefined}>
      {items.map(({ task, dueText }) => (
        <li key={task.id} className={styles.item}>
          {showTime ? (
            <span className={styles.time} data-testid="row-time">
              {task.doDate === today && planTime(task) !== null ? (
                <>
                  <span className="sr-only">Starts </span>
                  {formatTimeOfDay(planTime(task) as string)}
                </>
              ) : null}
            </span>
          ) : null}
          <TaskRow
            onStartFocus={task.status === 'done' ? undefined : startFocus}
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
  id: 'fromGoals' | 'yours' | 'today'
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

interface CarriedOverProps extends RowsProps {
  onMoveAll: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Work planned for an earlier day that is still open. No guilt: a plain, quiet header you can fold away,
 * each row says the day it came from ("from Tue") rather than how late it is, and one click moves them
 * all to today.
 */
export function CarriedOverGroup({
  items,
  onMoveAll,
  open,
  onOpenChange,
  ...rest
}: CarriedOverProps) {
  const headingId = useId()
  const listId = useId()
  return (
    <section className={styles.group} data-group="carriedOver" aria-labelledby={headingId}>
      <div className={styles.headerRow}>
        <h2 className={styles.header} id={headingId}>
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => onOpenChange(!open)}
          >
            <ChevronRight className={styles.chevron} size={14} aria-hidden="true" />
            <span>Carried over</span>
            <span className={styles.count}>{items.length}</span>
          </button>
        </h2>
        {open ? (
          <Tooltip content="Move every carried-over task to today" shortcut="shift+t">
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
        ) : null}
      </div>
      <div id={listId} hidden={!open}>
        {open ? <Rows items={items} {...rest} /> : null}
      </div>
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
