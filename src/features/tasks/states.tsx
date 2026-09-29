import {
  CalendarDays,
  CircleAlert,
  CircleCheckBig,
  Inbox,
  ListChecks,
  Plus,
  SearchX,
} from 'lucide-react'
import { useOverlays } from '@/app/providers/OverlayProvider'
import type { TaskListId } from '@/logic/taskLists'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Kbd } from '@/ui/Kbd'
import { Skeleton } from '@/ui/Skeleton'
import styles from './states.module.css'

const EMPTY_COPY: Record<TaskListId, { icon: typeof Inbox; title: string; description: string }> = {
  inbox: {
    icon: Inbox,
    title: 'Inbox zero',
    description:
      'Tasks you capture without a goal land here. Try “Email mentor about term plan tomorrow”.',
  },
  upcoming: {
    icon: CalendarDays,
    title: 'Nothing coming up',
    description: 'Give a task a due date and it shows up here, soonest first.',
  },
  all: {
    icon: ListChecks,
    title: 'No open tasks',
    description:
      'Add one now, or set up a goal such as your B.S. in Computer Science and Forge plans your study days.',
  },
  completed: {
    icon: CircleCheckBig,
    title: 'Nothing completed yet',
    description:
      'Finished tasks collect here with the XP they earned. Tick one off and it lands on today.',
  },
}

/** "Add a task" opens quick add, the same place `Q` and `N` go. */
function AddTaskButton() {
  const overlays = useOverlays()
  return (
    <Button variant="primary" iconLeft={<Plus />} onClick={() => overlays.open('quickAdd')}>
      Add a task
    </Button>
  )
}

export function ListEmpty({ list }: { list: TaskListId }) {
  const copy = EMPTY_COPY[list]
  const Icon = copy.icon
  return (
    <EmptyState
      icon={<Icon />}
      title={copy.title}
      description={copy.description}
      action={
        <>
          <AddTaskButton />
          <span className={styles.hint}>
            or press <Kbd keys="n" size="sm" />
          </span>
        </>
      }
    />
  )
}

/** Tasks exist, but the filters hide all of them. */
export function ListFilteredEmpty({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      icon={<SearchX />}
      title="No tasks match these filters"
      description="Loosen a filter, or clear them all to see everything in this list."
      action={
        <Button variant="secondary" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  )
}

const ROW_WIDTHS = ['62%', '48%', '71%', '55%', '66%', '43%']

/** Placeholder rows while tasks load. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true" aria-label="Loading tasks">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <Skeleton variant="circle" width={18} />
          <Skeleton width={ROW_WIDTHS[i % ROW_WIDTHS.length]} />
        </div>
      ))}
    </div>
  )
}

export function ListError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={<CircleAlert />}
      title="Couldn’t load your tasks"
      description="Your data is safe on this device. Try again, or reload the page."
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  )
}
