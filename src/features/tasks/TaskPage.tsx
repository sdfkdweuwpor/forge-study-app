import { CircleAlert } from 'lucide-react'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { Link, navigate, navigateToUrl, href, useParams, usePageTitle } from '@/app/router'
import { useTask } from '@/db/hooks/useTasks'
import { Breadcrumbs, type BreadcrumbLinkProps } from '@/ui/Breadcrumbs'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { TaskActionsProvider } from './TaskActions'
import { TaskDetail } from './TaskDetail'
import { useTaskShortcuts } from './useTaskShortcuts'
import styles from './TaskPage.module.css'

function crumbLink({ item, className, children }: BreadcrumbLinkProps): ReactNode {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (item.href) {
      e.preventDefault()
      navigateToUrl(item.href)
    }
  }
  return (
    <a href={item.href} className={className} onClick={onClick}>
      {children}
    </a>
  )
}

function TaskPageScreen() {
  const { taskId } = useParams<'task'>()
  const task = useTask(taskId)
  usePageTitle(task?.title)
  const [tagsNonce, setTagsNonce] = useState(0)
  useTaskShortcuts({ task: task ?? null, editTags: () => setTagsNonce((n) => n + 1) })

  if (task === undefined) {
    return (
      <div className={styles.root}>
        <h1 className="sr-only">Task</h1>
        <div className={styles.loading} role="status" aria-busy="true" aria-label="Loading task">
          <Skeleton variant="block" width="60%" height={36} />
          <Skeleton lines={5} />
        </div>
      </div>
    )
  }

  if (task === null) {
    return (
      <div className={styles.root}>
        <h1 className={styles.missingTitle}>Task not found</h1>
        <EmptyState
          align="start"
          icon={<CircleAlert />}
          titleAs="p"
          title="This task isn’t here"
          description="It may have been moved to the trash or deleted. Trashed tasks stay there for 30 days."
          action={
            <Link to="tasks" params={{ list: 'all' }} className={styles.back}>
              Back to all tasks
            </Link>
          }
        />
      </div>
    )
  }

  const list = task.status === 'done' ? 'completed' : 'all'
  return (
    <div className={styles.root}>
      <Breadcrumbs
        className={styles.crumbs}
        renderLink={crumbLink}
        items={[
          { label: 'Tasks', href: href('tasks', { list }) },
          { label: task.title },
        ]}
      />
      <TaskDetail
        task={task}
        variant="page"
        focusTagsNonce={tagsNonce}
        onDeleted={() => navigate('tasks', { list })}
      />
    </div>
  )
}

/** `/task/:taskId`: the full page for one task (and what a task opens as on a phone). */
export default function TaskPage() {
  return (
    <TaskActionsProvider>
      <TaskPageScreen />
    </TaskActionsProvider>
  )
}
