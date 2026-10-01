import { useMemo, useState } from 'react'
import { TaskActionsProvider, TaskList } from '@/features/tasks'
import type { ID, Task } from '@/db/types'
import { plural } from '@/logic/goalDisplay'
import { Button } from '@/ui/Button'
import styles from './CourseTasks.module.css'

const noReorder = (): void => undefined

function Tasks({ tasks, courseDone }: { tasks: readonly Task[]; courseDone: boolean }) {
  const [selected, setSelected] = useState<ID | null>(null)
  const [showDone, setShowDone] = useState(false)
  const open = useMemo(() => tasks.filter((t) => t.status !== 'done'), [tasks])
  const finished = useMemo(() => tasks.filter((t) => t.status === 'done'), [tasks])
  const groups = useMemo(
    () => [
      { id: 'open', label: '', tasks: open },
      ...(showDone && finished.length > 0
        ? [{ id: 'done', label: 'Completed', tasks: finished }]
        : []),
    ],
    [open, finished, showDone],
  )

  return (
    <div className={styles.root}>
      {open.length === 0 && !showDone ? (
        <p className={styles.empty}>
          {courseDone
            ? 'This course is complete, so nothing is scheduled.'
            : 'Nothing is scheduled for this course right now. Study blocks appear here once the goal has a plan.'}
        </p>
      ) : (
        <TaskList
          groups={groups}
          reorderable={false}
          selectedId={selected}
          onSelect={setSelected}
          onReorder={noReorder}
          showCourse={false}
        />
      )}
      {finished.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className={styles.toggle}
          onClick={() => setShowDone(!showDone)}
        >
          {showDone ? 'Hide completed' : `Show ${plural(finished.length, 'completed task')}`}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * The course's tasks, as the same rows the Tasks screen and Today use (complete, reschedule, focus and
 * the rest all work here). Open tasks first, dated; finished ones are one click away.
 */
export function CourseTasks({
  tasks,
  courseDone,
}: {
  tasks: readonly Task[]
  courseDone: boolean
}) {
  return (
    <TaskActionsProvider>
      <Tasks tasks={tasks} courseDone={courseDone} />
    </TaskActionsProvider>
  )
}
