import { SearchX } from 'lucide-react'
import { navigate } from '@/app/router'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { ListSkeleton } from './states'
import styles from './TasksPage.module.css'

/** A `/tasks/views/:id` link to a view that was deleted (or never existed). */
export function SavedViewMissing() {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>View not found</h1>
        </div>
      </header>
      <EmptyState
        icon={<SearchX />}
        title="This view doesn’t exist"
        description="It may have been deleted. Your tasks are all still in All tasks."
        action={
          <Button variant="secondary" onClick={() => navigate('tasks', { list: 'all' })}>
            Go to All tasks
          </Button>
        }
      />
    </>
  )
}

/** The page while the view itself is being read. */
export function SavedViewLoading() {
  return (
    <>
      <header className={styles.header} aria-hidden="true">
        <div className={styles.headerText}>
          <Skeleton width={220} height={40} variant="block" />
        </div>
      </header>
      <ListSkeleton />
    </>
  )
}
