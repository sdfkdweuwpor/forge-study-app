/**
 * The small pickers a row opens from its `…` menu or a shortcut: due date, priority, and goal/course.
 * Each acts on one task and closes itself when a choice is made.
 */
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ID, Task } from '@/db/types'
import { updateTask } from '@/db/repos/tasks'
import { recordError } from '@/app/reportError'
import { DatePicker } from '@/ui/DatePicker'
import { Kbd } from '@/ui/Kbd'
import { PopoverBody } from '@/ui/Popover'
import { PriorityFlag } from './PriorityFlag'
import { PRIORITIES, priorityKey, priorityLabel } from './priority'
import { useTaskActions, useTaskEnv } from './TaskActions'
import styles from './TaskPanels.module.css'

interface PanelProps {
  task: Task
  close: () => void
}

export function DuePanel({ task }: PanelProps) {
  const actions = useTaskActions()
  const { today, weekStartsOn } = useTaskEnv()
  return (
    <PopoverBody>
      <DatePicker
        label="Due date"
        value={task.dueDate}
        onChange={(date) => void actions.setDue(task.id, date)}
        withTime
        time={task.dueTime}
        onTimeChange={(time) => void actions.setDue(task.id, task.dueDate ?? today, time)}
        quickPicks
        today={today}
        weekStartsOn={weekStartsOn}
      />
    </PopoverBody>
  )
}

export function PriorityPanel({ task, close }: PanelProps) {
  const actions = useTaskActions()
  return (
    <PopoverBody>
      <div className={styles.list} role="group" aria-label="Priority">
        {PRIORITIES.map((p) => (
          <button
            key={p}
            type="button"
            className={styles.option}
            aria-pressed={task.priority === p}
            data-autofocus={task.priority === p ? '' : undefined}
            onClick={() => {
              void actions.setPriority(task.id, p)
              close()
            }}
          >
            <PriorityFlag priority={p} />
            <span className={styles.label}>{priorityLabel(p)}</span>
            {task.priority === p ? <Check className={styles.check} aria-hidden="true" /> : null}
            <Kbd keys={priorityKey(p)} variant="plain" size="sm" />
          </button>
        ))}
      </div>
    </PopoverBody>
  )
}

/** Sets or clears the goal and course link. Picking a course sets its goal too. */
export async function linkTask(id: ID, goalId: ID | null, milestoneId: ID | null): Promise<void> {
  try {
    await updateTask(id, { goalId, milestoneId, unitId: null })
  } catch (error) {
    recordError(error, 'linkTask')
  }
}

interface ProjectOption {
  key: string
  label: ReactNode
  goalId: ID | null
  milestoneId: ID | null
  current: boolean
  heading?: boolean
}

export function useProjectOptions(task: Pick<Task, 'goalId' | 'milestoneId'>): ProjectOption[] {
  const { projects } = useTaskEnv()
  const options: ProjectOption[] = [
    {
      key: 'none',
      label: 'No goal or course',
      goalId: null,
      milestoneId: null,
      current: task.goalId === null && task.milestoneId === null,
    },
  ]
  for (const goal of projects?.goals ?? []) {
    options.push({ key: `heading:${goal.id}`, label: `${goal.icon} ${goal.title}`, goalId: null, milestoneId: null, current: false, heading: true })
    options.push({
      key: `goal:${goal.id}`,
      label: 'Whole goal',
      goalId: goal.id,
      milestoneId: null,
      current: task.goalId === goal.id && task.milestoneId === null,
    })
    for (const course of projects?.courses.filter((c) => c.goalId === goal.id) ?? []) {
      options.push({
        key: `course:${course.id}`,
        label: course.label,
        goalId: goal.id,
        milestoneId: course.id,
        current: task.milestoneId === course.id,
      })
    }
  }
  return options
}

export function ProjectPanel({ task, close }: PanelProps) {
  const options = useProjectOptions(task)
  return (
    <PopoverBody>
      <div className={styles.list} role="group" aria-label="Move to">
        {options.map((o) =>
          o.heading ? (
            <div key={o.key} className={styles.heading}>
              {o.label}
            </div>
          ) : (
            <button
              key={o.key}
              type="button"
              className={styles.option}
              aria-pressed={o.current}
              data-autofocus={o.current ? '' : undefined}
              onClick={() => {
                void linkTask(task.id, o.goalId, o.milestoneId)
                close()
              }}
            >
              <span className={styles.label}>{o.label}</span>
              {o.current ? <Check className={styles.check} aria-hidden="true" /> : null}
            </button>
          ),
        )}
      </div>
    </PopoverBody>
  )
}
