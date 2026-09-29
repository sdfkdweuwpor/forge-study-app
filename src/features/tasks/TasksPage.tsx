/**
 * `/tasks/:list?`: Inbox, Upcoming, All tasks and Completed. Grouped by date or project, sorted and
 * filtered from the address bar, with a right-hand peek panel for the open task (`?peek=<id>`).
 */
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useMediaQuery } from '@/app/hooks/useMediaQuery'
import { useOverlays } from '@/app/providers/OverlayProvider'
import { recordError } from '@/app/reportError'
import { navigate, setQuery, useParams, useQuery } from '@/app/router'
import { useTasks } from '@/db/hooks/useTasks'
import { useXpSummary } from '@/db/hooks/useXpSummary'
import { moveTask } from '@/db/repos/tasks'
import type { ID } from '@/db/types'
import { neighboursAfterStep } from '@/logic/order'
import { diffDays } from '@/logic/dates'
import {
  canReorder,
  clearFilters,
  viewFromQuery,
  viewToQuery,
  type TaskListView,
} from '@/logic/taskListView'
import {
  groupCompleted,
  inList,
  listFromParam,
  listLabel,
  type TaskListId,
} from '@/logic/taskLists'
import { queryTasks } from '@/logic/taskQuery'
import { Button } from '@/ui/Button'
import { Kbd } from '@/ui/Kbd'
import { useToast } from '@/ui/Toast'
import { FilterBar } from './FilterBar'
import { TaskActionsProvider, useTaskEnv, useTaskMotion } from './TaskActions'
import { TaskList } from './TaskList'
import { TaskPeek } from './TaskPeek'
import { ListEmpty, ListError, ListFilteredEmpty, ListSkeleton } from './states'
import { PEEK_MEDIA_QUERY, closePeek, openTask } from './taskUrls'
import { projectRefsOf, useTagList, useTaskXpMap } from './queries'
import { useTaskShortcuts } from './useTaskShortcuts'
import styles from './TasksPage.module.css'

const DESCRIPTIONS: Record<TaskListId, string> = {
  inbox: 'your own tasks, not tied to a goal',
  upcoming: 'due after today, soonest first',
  all: 'everything still open',
  completed: 'newest first',
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function TasksBody({ list }: { list: TaskListId }) {
  const query = useQuery()
  const env = useTaskEnv()
  const motion = useTaskMotion()
  const toast = useToast()
  const overlays = useOverlays()
  const tasks = useTasks()
  const tags = useTagList()
  const xp = useXpSummary(env.today)
  const xpByTask = useTaskXpMap(list === 'completed')
  const peekFits = useMediaQuery(PEEK_MEDIA_QUERY)

  const view = useMemo(() => viewFromQuery(list, query), [list, query])
  const peekId = query.peek ?? null
  const [selectedId, setSelectedId] = useState<ID | null>(null)
  const [tagsNonce, setTagsNonce] = useState(0)
  const [byKeyboard, setByKeyboard] = useState(false)

  const { today, weekStartsOn, projects } = env
  const projectRefs = useMemo(() => (projects ? projectRefsOf(projects) : []), [projects])

  const result = useMemo(() => {
    if (!tasks) return undefined
    // Rows completing right now stay on screen, drawn as still open, until their motion ends.
    const pool = tasks
      .filter((t) => inList(t, list, { today }) || motion.has(t.id))
      .map((t) => (motion.has(t.id) && t.status === 'done' ? { ...t, status: 'todo' as const } : t))
    const queried = queryTasks(
      pool,
      { filter: view.filter, sort: view.sort, groupBy: view.groupBy },
      { today, weekStartsOn, projects: projectRefs },
    )
    const groups = list === 'completed' ? groupCompleted(queried.tasks, { today }) : queried.groups
    const overdue = pool.filter(
      (t) => t.status !== 'done' && t.dueDate !== null && diffDays(t.dueDate, today) < 0,
    ).length
    return { total: pool.length, tasks: queried.tasks, groups, overdue }
  }, [tasks, list, view, today, weekStartsOn, projectRefs, motion])

  const visibleIds = useMemo(
    () => result?.groups.flatMap((g) => g.tasks.map((t) => t.id)) ?? [],
    [result],
  )
  // With no row picked yet, the one open in the peek panel is the selection.
  const pick = selectedId ?? peekId
  const selected = pick !== null && visibleIds.includes(pick) ? pick : null
  const selectedTask = useMemo(
    () => result?.tasks.find((t) => t.id === selected) ?? null,
    [result, selected],
  )

  const reorderable = canReorder(list, view)

  // A phone has no room beside the list: the peek link becomes the task's own page.
  useEffect(() => {
    if (peekId && !peekFits) navigate('task', { taskId: peekId }, { replace: true })
  }, [peekId, peekFits])

  const setView = useCallback((next: TaskListView) => setQuery(viewToQuery(list, next)), [list])

  const select = useCallback(
    (id: ID, viaKeyboard = false) => {
      setByKeyboard(viaKeyboard)
      setSelectedId(id)
      if (peekId && peekId !== id) setQuery({ peek: id })
    },
    [peekId],
  )

  const reorder = useCallback(
    (id: ID, above: ID | null, below: ID | null) => {
      moveTask(id, { reorder: { above, below } }).catch((error: unknown) => {
        recordError(error, 'moveTask')
        toast.error('Couldn’t move the task', { description: 'Nothing was changed. Try again.' })
      })
    },
    [toast],
  )

  useTaskShortcuts({
    task: selectedTask,
    editTags: () => {
      if (!selectedTask) return
      if (!peekId) openTask(selectedTask.id)
      setTagsNonce((n) => n + 1)
    },
    beforeLeave: (task) => {
      // Selection moves on to the neighbour so the keyboard never loses its place.
      const at = visibleIds.indexOf(task.id)
      const next = visibleIds[at + 1] ?? visibleIds[at - 1] ?? null
      setSelectedId(next)
      if (peekId) {
        if (next) setQuery({ peek: next })
        else closePeek()
      }
    },
    list: {
      moveSelection: (step) => {
        if (visibleIds.length === 0) return
        const from = selected ? visibleIds.indexOf(selected) : -1
        const to =
          from === -1
            ? step === 1
              ? 0
              : visibleIds.length - 1
            : Math.min(visibleIds.length - 1, Math.max(0, from + step))
        const id = visibleIds[to]
        if (id) select(id, true)
      },
      open: () => {
        if (selected) openTask(selected)
      },
      reorder: (step) => {
        if (!selected || !result) return
        if (!reorderable) {
          toast.show({
            title: 'Reordering is off',
            description: 'Choose Manual under Sort to move tasks yourself.',
          })
          return
        }
        const group = result.groups.find((g) => g.tasks.some((t) => t.id === selected))
        const neighbours = group
          ? neighboursAfterStep(
              group.tasks.map((t) => t.id),
              selected,
              step,
            )
          : null
        if (neighbours) reorder(selected, neighbours.above, neighbours.below)
      },
      escape: () => {
        if (peekId) {
          closePeek()
          return true
        }
        if (selected) {
          setSelectedId(null)
          return true
        }
        return false
      },
    },
  })

  const summary = result
    ? [
        list === 'completed'
          ? `${plural(result.total, 'task')} done`
          : plural(result.total, 'task'),
        result.overdue > 0 ? `${result.overdue} overdue` : null,
        list === 'completed' && xp && xp.today > 0 ? `+${xp.today} XP today` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>{listLabel(list)}</h1>
          <p className={styles.subtitle}>
            {summary}
            <span className={styles.description}>
              {summary ? ' · ' : ''}
              {DESCRIPTIONS[list]}
            </span>
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Plus />}
          className={styles.add}
          onClick={() => overlays.open('quickAdd')}
        >
          Add task <Kbd keys="n" size="sm" variant="plain" />
        </Button>
      </header>

      {result === undefined || result.total > 0 ? (
        <FilterBar
          list={list}
          view={view}
          onChange={setView}
          courses={projects?.courses ?? []}
          tags={tags ?? []}
        />
      ) : null}

      {result === undefined ? (
        <ListSkeleton />
      ) : result.total === 0 ? (
        <ListEmpty list={list} />
      ) : result.groups.length === 0 ? (
        <ListFilteredEmpty onClear={() => setView(clearFilters(view))} />
      ) : (
        <TaskList
          groups={result.groups}
          reorderable={reorderable}
          selectedId={selected}
          onSelect={select}
          onReorder={reorder}
          xpByTask={xpByTask}
          revealSelected={byKeyboard}
          showCourse={view.groupBy !== 'project'}
        />
      )}

      {peekId && peekFits ? (
        <TaskPeek key="peek" taskId={peekId} onClose={closePeek} focusTagsNonce={tagsNonce} />
      ) : null}
    </>
  )
}

function TasksScreen() {
  const { list: listParam } = useParams<'tasks'>()
  const list = listFromParam(listParam)
  return (
    <div className={styles.root}>
      <ErrorBoundary
        resetKey={list}
        fallback={(_error, reset) => (
          <>
            <header className={styles.header}>
              <h1 className={styles.title}>{listLabel(list)}</h1>
            </header>
            <ListError onRetry={reset} />
          </>
        )}
      >
        <TasksBody list={list} />
      </ErrorBoundary>
    </div>
  )
}

export default function TasksPage() {
  return (
    <TaskActionsProvider>
      <TasksScreen />
    </TaskActionsProvider>
  )
}
