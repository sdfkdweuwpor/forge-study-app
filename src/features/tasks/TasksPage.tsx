/**
 * `/tasks/:list?`: Inbox, Upcoming, All tasks and Completed. Grouped by date or project, sorted and
 * filtered from the address bar, with a right-hand peek panel for the open task (`?peek=<id>`).
 */
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { BREAKPOINTS, useMediaQuery } from '@/app/hooks/useMediaQuery'
import { useOverlays } from '@/app/providers/OverlayProvider'
import { recordError } from '@/app/reportError'
import { navigate, setQuery, useQuery, useRoute, usePageTitle } from '@/app/router'
import { useSavedView } from '@/db/hooks/useSavedViews'
import { useTasks } from '@/db/hooks/useTasks'
import { useXpSummary } from '@/db/hooks/useXpSummary'
import { moveTask } from '@/db/repos/tasks'
import type { ID, SavedView, Task } from '@/db/types'
import {
  boardIds,
  boardOrderIds,
  boardReorderable,
  buildBoard,
  findColumn,
  inLayoutList,
  moveByColumn,
  placementOf,
} from '@/logic/boardColumns'
import {
  calendarOrderIds,
  nudgeLength,
  nudgeSlot,
  shiftAnchor,
  visibleDays,
} from '@/logic/calendarWeek'
import { diffDays, isISODate } from '@/logic/dates'
import { neighboursAfterStep } from '@/logic/order'
import {
  activeFilterCount,
  canReorder,
  clearFilters,
  isDefaultView,
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
import { filterTasks, queryTasks, sortTasks } from '@/logic/taskQuery'
import { planDay } from '@/logic/taskDates'
import {
  SAVED_VIEW_LIST,
  canSaveView,
  layoutsFor,
  resolveLayout,
  savedViewQuery,
  savedViewState,
  type TaskLayout,
} from '@/logic/taskViews'
import { ExportMenu } from '@/features/export'
import { Button } from '@/ui/Button'
import { Kbd } from '@/ui/Kbd'
import { useToast } from '@/ui/Toast'
import { AutoSlotSuggestions } from './AutoSlotSuggestions'
import { FilterBar } from './FilterBar'
import { SavedViewActions, SaveViewButton } from './SavedViewsActions'
import { SavedViewsMenu } from './SavedViewsMenu'
import { SavedViewLoading, SavedViewMissing } from './SavedViewsStates'
import { TaskActionsProvider, useTaskEnv, useTaskMotionSelector } from './TaskActions'
import { TaskList } from './TaskList'
import { TaskPeek } from './TaskPeek'
import { ListEmpty, ListError, ListFilteredEmpty, ListSkeleton } from './states'
import { PEEK_MEDIA_QUERY, closePeek, openTask } from './taskUrls'
import { projectRefsOf, useTagList, useTaskXpMap } from './queries'
import { useTaskShortcuts } from './useTaskShortcuts'
import { BoardSkeleton } from './views/BoardStates'
import { useBoardMove } from './views/BoardMove'
import { BoardView } from './views/BoardView'
import { useReschedule, useResize } from './views/CalendarReschedule'
import { refocusEvent } from './views/CalendarEvent'
import { CalendarSkeleton } from './views/CalendarStates'
import { CalendarView } from './views/CalendarView'
import { LayoutSwitch, rememberLayout, useLayoutPrefs } from './views/LayoutSwitch'
import { useViewShortcuts } from './views/useViewShortcuts'
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

interface TasksBodyProps {
  /** Which tasks are in play. A saved view runs over `all`. */
  list: TaskListId
  saved: SavedView | null
}

function TasksBody({ list, saved }: TasksBodyProps) {
  const query = useQuery()
  const env = useTaskEnv()
  const toast = useToast()
  const overlays = useOverlays()
  const tasks = useTasks()
  const tags = useTagList()
  const xp = useXpSummary(env.today)
  const xpByTask = useTaskXpMap(list === 'completed')
  const peekFits = useMediaQuery(PEEK_MEDIA_QUERY)
  const wide = useMediaQuery(BREAKPOINTS.tablet)
  const boardMove = useBoardMove()
  const reschedule = useReschedule()
  const resize = useResize()
  usePageTitle(saved?.name)

  // A saved view shows its stored settings until the address bar holds edits (`mod=1`).
  const savedState = useMemo(() => (saved ? savedViewState(saved, query) : null), [saved, query])
  const view = useMemo(
    () => savedState?.view ?? viewFromQuery(list, query),
    [savedState, list, query],
  )
  const layouts = layoutsFor(list)
  // Live, so a layout chosen from the palette (which only writes the preference) applies at once.
  const layoutPrefs = useLayoutPrefs()
  const layout: TaskLayout = savedState
    ? savedState.layout
    : resolveLayout(list, query.layout, layoutPrefs)
  const peekId = query.peek ?? null
  const [selectedId, setSelectedId] = useState<ID | null>(null)
  const [tagsNonce, setTagsNonce] = useState(0)
  const [byKeyboard, setByKeyboard] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)

  const { today, weekStartsOn, projects } = env
  const projectRefs = useMemo(() => (projects ? projectRefsOf(projects) : []), [projects])
  const courseLabels = useMemo(
    () => Object.fromEntries((projects?.courses ?? []).map((c) => [c.id, c.label])),
    [projects],
  )

  const taskById = useMemo(() => new Map<ID, Task>((tasks ?? []).map((t) => [t.id, t])), [tasks])
  // Rows completing right now stay on screen, drawn as still open, until their motion ends. Only the
  // rows that would otherwise leave the list (done, or not in it) change what it holds, so a click
  // and each step of the motion do not re-query every task.
  const heldKey = useTaskMotionSelector((motion) =>
    [...motion.keys()]
      .filter((id) => {
        const t = taskById.get(id)
        return t !== undefined && (t.status === 'done' || !inList(t, list, { today }))
      })
      .sort()
      .join(' '),
  )
  const result = useMemo(() => {
    if (!tasks) return undefined
    const held = new Set(heldKey === '' ? [] : heldKey.split(' '))
    const pool = tasks
      .filter((t) => inList(t, list, { today }) || held.has(t.id))
      .map((t) => (held.has(t.id) && t.status === 'done' ? { ...t, status: 'todo' as const } : t))
    const queried = queryTasks(
      pool,
      { filter: view.filter, sort: view.sort, groupBy: view.groupBy },
      { today, weekStartsOn, projects: projectRefs },
    )
    const groups = list === 'completed' ? groupCompleted(queried.tasks, { today }) : queried.groups
    // A saved view counts what it shows; a list counts what is in it (the filters then narrow it).
    const counted = saved ? queried.tasks : pool
    const overdue = counted.filter((t) => {
      const day = planDay(t)
      return t.status !== 'done' && day !== null && diffDays(day, today) < 0
    }).length
    return { total: pool.length, shown: counted.length, tasks: queried.tasks, groups, overdue }
  }, [tasks, list, saved, view, today, weekStartsOn, projectRefs, heldKey])

  const board = useMemo(
    () =>
      layout === 'board' && tasks
        ? buildBoard(tasks, list, { filter: view.filter, sort: view.sort }, { today, weekStartsOn })
        : null,
    [layout, tasks, list, view, today, weekStartsOn],
  )

  const dayCount = wide ? 7 : 3
  const anchor = query.date && isISODate(query.date) ? query.date : today
  const days = useMemo(
    () => visibleDays(anchor, dayCount, weekStartsOn),
    [anchor, dayCount, weekStartsOn],
  )
  const calendar = useMemo(() => {
    if (layout !== 'calendar' || !tasks) return null
    const pool = tasks.filter((t) => inLayoutList(t, list, { today }))
    const filtered = filterTasks(pool, view.filter, { today, weekStartsOn })
    return { total: pool.length, tasks: sortTasks(filtered, view.sort) }
  }, [layout, tasks, list, view, today, weekStartsOn])

  const visibleIds = useMemo(() => {
    if (layout === 'board') return board ? boardOrderIds(board) : []
    if (layout === 'calendar') return calendar ? calendarOrderIds(calendar.tasks, days) : []
    return result?.groups.flatMap((g) => g.tasks.map((t) => t.id)) ?? []
  }, [layout, board, calendar, days, result])
  // With no row picked yet, the one open in the peek panel is the selection.
  const pick = selectedId ?? peekId
  const selected = pick !== null && visibleIds.includes(pick) ? pick : null
  const selectedTask = useMemo(
    () =>
      selected === null
        ? null
        : (result?.tasks.find((t) => t.id === selected) ??
          tasks?.find((t) => t.id === selected) ??
          null),
    [result, tasks, selected],
  )
  const reorderable = canReorder(list, view)
  const boardReorder = boardReorderable(view.sort)

  // A phone has no room beside the list: the peek link becomes the task's own page.
  useEffect(() => {
    if (peekId && !peekFits) navigate('task', { taskId: peekId }, { replace: true })
  }, [peekId, peekFits])

  const setView = useCallback(
    (next: TaskListView) => {
      if (saved) setQuery(savedViewQuery(saved, next, layout))
      else setQuery(viewToQuery(list, next))
    },
    [saved, list, layout],
  )

  const setLayout = useCallback(
    (next: TaskLayout) => {
      if (saved) {
        setQuery(savedViewQuery(saved, view, next))
        return
      }
      // The choice is remembered per list, on this device; the address bar carries it for links.
      rememberLayout(list, next)
      setQuery({ layout: next === 'list' ? undefined : next })
    },
    [saved, list, view],
  )

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

  const moveCard = useCallback(
    (move: Parameters<typeof boardMove>[1]) => {
      const task = taskById.get(move.id)
      return task ? boardMove(task, move) : Promise.resolve(false)
    },
    [boardMove, taskById],
  )

  const requestSave = () => {
    if (!saved && !canSaveView(list)) {
      toast.show({
        title: 'Completed can’t be saved as a view',
        description: 'Saved views cover your open tasks. Open All tasks to save one.',
      })
      return
    }
    if (!saved && !isDefaultView(list, view)) {
      setSaveOpen(true)
      return
    }
    toast.show({
      title: saved ? 'This view is saved' : 'Nothing to save yet',
      description: saved
        ? savedState?.modified
          ? 'Use Update view to keep your changes.'
          : 'Change its filters or layout, then update it.'
        : 'Filter, sort or group the list first, then save it as a view.',
    })
  }

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
        if (!selected || !selectedTask) return
        if (layout === 'calendar') return
        if (layout === 'board') {
          if (!board) return
          if (!boardReorder) {
            toast.show({
              title: 'Reordering is off',
              description: 'Choose Manual under Sort to move cards yourself.',
            })
            return
          }
          const ids = boardIds(board)
          const column = findColumn(ids, selected)
          if (!column || column === 'done') return
          const neighbours = neighboursAfterStep(ids[column], selected, step)
          if (neighbours) {
            void boardMove(selectedTask, {
              id: selected,
              from: column,
              to: column,
              above: neighbours.above,
              below: neighbours.below,
              reorder: true,
            })
          }
          return
        }
        if (!result) return
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

  // After `useTaskShortcuts`: the calendar's scope must be pushed after (so above) `tasks`, or `t` and
  // Alt+↑/↓ would go to "due today" and "reorder" instead of the calendar.
  useViewShortcuts({
    layout,
    layouts,
    setLayout,
    saveView: requestSave,
    hasSelection: selectedTask !== null,
    board: {
      move: (step) => {
        if (!board || !selectedTask) return
        const ids = boardIds(board)
        const from = findColumn(ids, selectedTask.id)
        const next = moveByColumn(ids, selectedTask.id, step)
        const now = next ? placementOf(next, selectedTask.id) : null
        if (!from || !now) return
        void boardMove(selectedTask, {
          id: selectedTask.id,
          from,
          to: now.column,
          above: now.above,
          below: null,
          reorder: boardReorder && now.column !== 'done',
        })
      },
    },
    calendar: {
      shift: (direction) => setQuery({ date: shiftAnchor(anchor, dayCount, direction) }),
      today: () => setQuery({ date: undefined }),
      nudge: (change) => {
        if (!selectedTask) return
        const slot = nudgeSlot(selectedTask, change)
        if (!slot) return
        refocusEvent(selectedTask.id)
        void reschedule(selectedTask, slot)
      },
      resize: (minutes) => {
        if (!selectedTask) return
        const next = nudgeLength(selectedTask, minutes)
        if (next !== null) void resize(selectedTask, next)
      },
    },
  })

  const summary = result
    ? [
        list === 'completed'
          ? `${plural(result.total, 'task')} done`
          : plural(result.shown, 'task'),
        result.overdue > 0 ? `${result.overdue} carried over` : null,
        list === 'completed' && xp && xp.today > 0 ? `+${xp.today} XP today` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  // How many tasks the layout has before filters: `undefined` while loading, 0 for an empty list.
  const total =
    layout === 'board' ? board?.total : layout === 'calendar' ? calendar?.total : result?.total
  const filtered = activeFilterCount(view.filter) > 0
  const boardHidden =
    board !== null && board.total > 0 && boardOrderIds(board).length === 0 && board.olderDone === 0

  const layoutSwitch = <LayoutSwitch value={layout} layouts={layouts} onChange={setLayout} />
  const trailing = saved ? (
    savedState?.modified ? (
      <SavedViewActions saved={saved} view={view} layout={layout} />
    ) : null
  ) : canSaveView(list) && !isDefaultView(list, view) ? (
    <SaveViewButton
      list={list}
      view={view}
      layout={layout}
      courseLabels={courseLabels}
      open={saveOpen}
      onOpenChange={setSaveOpen}
    />
  ) : null

  return (
    <div className={styles.body} data-page-width={layout === 'list' ? undefined : 'wide'}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>
            {saved ? (
              <>
                <span className={styles.icon} aria-hidden="true">
                  {saved.icon}
                </span>
                {saved.name}
              </>
            ) : (
              listLabel(list)
            )}
          </h1>
          <p className={styles.subtitle}>
            {summary}
            <span className={styles.description}>
              {summary ? ' · ' : ''}
              {saved ? 'saved view' : DESCRIPTIONS[list]}
            </span>
          </p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.viewsMenu}>
            <SavedViewsMenu />
          </span>
          <ExportMenu />
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Plus />}
            onClick={() => overlays.open('quickAdd')}
          >
            Add task <Kbd keys="n" size="sm" variant="plain" />
          </Button>
        </div>
      </header>

      {!saved && (list === 'inbox' || list === 'upcoming') ? <AutoSlotSuggestions /> : null}

      {total === undefined || total > 0 ? (
        <FilterBar
          list={list}
          view={view}
          onChange={setView}
          courses={projects?.courses ?? []}
          tags={tags ?? []}
          leading={layoutSwitch}
          trailing={trailing}
          showGroup={layout === 'list'}
          showSort={layout !== 'calendar'}
        />
      ) : null}

      {tasks === undefined || total === undefined ? (
        layout === 'board' ? (
          <BoardSkeleton />
        ) : layout === 'calendar' ? (
          <CalendarSkeleton days={dayCount} />
        ) : (
          <ListSkeleton />
        )
      ) : total === 0 ? (
        <ListEmpty list={list} />
      ) : layout === 'board' && board ? (
        boardHidden ? (
          <ListFilteredEmpty onClear={() => setView(clearFilters(view))} />
        ) : (
          <BoardView
            model={board}
            reorderable={boardReorder}
            selectedId={selected}
            revealSelected={byKeyboard}
            onSelect={select}
            onMove={moveCard}
          />
        )
      ) : layout === 'calendar' && calendar ? (
        filtered && calendar.tasks.length === 0 ? (
          <ListFilteredEmpty onClear={() => setView(clearFilters(view))} />
        ) : (
          <CalendarView
            tasks={calendar.tasks}
            days={days}
            today={today}
            selectedId={selected}
            revealSelected={byKeyboard}
            onSelect={select}
            onReschedule={reschedule}
            onResize={resize}
            onShift={(direction) => setQuery({ date: shiftAnchor(anchor, dayCount, direction) })}
            onToday={() => setQuery({ date: undefined })}
          />
        )
      ) : result === undefined ? null : result.groups.length === 0 ? (
        <ListFilteredEmpty onClear={() => setView(clearFilters(view))} />
      ) : (
        <TaskList
          key={saved ? `view:${saved.id}` : list}
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
    </div>
  )
}

/** A saved view: read it, then show it over all open tasks. */
function SavedViewScreen({ viewId }: { viewId: string }) {
  const saved = useSavedView(viewId)
  if (saved === undefined) return <SavedViewLoading />
  if (saved === null) return <SavedViewMissing />
  return <TasksBody list={SAVED_VIEW_LIST} saved={saved} />
}

function TasksScreen() {
  const route = useRoute()
  const list = route.name === 'tasks' ? listFromParam(route.params.list) : SAVED_VIEW_LIST
  const viewId = route.name === 'taskView' ? route.params.viewId : null
  return (
    <div className={styles.root}>
      <ErrorBoundary
        resetKey={viewId ?? list}
        fallback={(_error, reset) => (
          <>
            <header className={styles.header}>
              <h1 className={styles.title}>{viewId ? 'Saved view' : listLabel(list)}</h1>
            </header>
            <ListError onRetry={reset} />
          </>
        )}
      >
        {viewId ? <SavedViewScreen viewId={viewId} /> : <TasksBody list={list} saved={null} />}
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
