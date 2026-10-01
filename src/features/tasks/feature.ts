import {
  BookmarkPlus,
  CalendarClock,
  CalendarDays,
  CircleCheckBig,
  Columns3,
  List,
  ListChecks,
} from 'lucide-react'
import { lazy } from 'react'
import type { CommandDef, FeatureManifest, SearchProvider } from '@/app/registry'
import { currentPath, navigate, setQuery } from '@/app/router'
import { dayOf } from '@/logic/dates'
import type { TaskListId } from '@/logic/taskLists'
import { taskShortcuts } from './shortcuts'
import { isSuggestionsCardMounted, openSuggestionsCard } from './suggestionsCard'
import { viewShortcuts } from './views/viewShortcuts'
import type { TaskLayout } from '@/logic/taskViews'

/** Palette search over task titles, notes, checklists and tags. Choosing a result opens the task's page. */
const taskSearch: SearchProvider = {
  id: 'tasks',
  group: 'Tasks',
  async search(query, limit) {
    // The repository, the text search and the date wording load with the first search, not with the app.
    const [{ searchTasks }, { relativeDay }] = await Promise.all([
      import('./queries'),
      import('@/logic/taskDisplay'),
    ])
    const hits = await searchTasks(query, limit)
    return hits.map(({ task, in: where }) => ({
      id: task.id,
      title: task.title,
      subtitle:
        task.status === 'done'
          ? 'Completed'
          : task.doDate
            ? relativeDay(task.doDate, dayOf(Date.now()))
            : task.dueDate
              ? `Due ${relativeDay(task.dueDate, dayOf(Date.now()))}`
              : where === 'title'
                ? 'No date'
                : `Matches in ${where === 'subtask' ? 'a subtask' : where}`,
      icon: task.status === 'done' ? CircleCheckBig : ListChecks,
      run: (c) => c.navigate('task', { taskId: task.id }),
    }))
  },
}

/** The saved views under Tasks in the sidebar. */
const SavedViewsNav = lazy(() =>
  import('./SavedViewsNav').then((m) => ({ default: m.SavedViewsNav })),
)

/** Loads with Settings, not with the app. */
const EverydayHoursSection = lazy(() =>
  import('./EverydayHours').then((m) => ({ default: m.EverydayHoursSection })),
)

/** Both routes are one page: `/tasks/views/:viewId` is the Tasks screen showing a saved view. */
const TasksPage = lazy(() => import('./TasksPage'))

const onTasksPage = (): boolean => currentPath().startsWith('/tasks')

/** Saved views cover open tasks, so Completed has nothing to save. */
const canSaveHere = (): boolean => {
  if (!onTasksPage()) return false
  const [, second] = currentPath().split('/').filter(Boolean)
  // Every other list and every saved view can be saved (`canSaveView` in `logic/taskViews`, which is not in
  // the first download, says the same).
  return second !== 'completed'
}

/**
 * "Show tasks as a board": on a Tasks page it changes the layout in place (and remembers it for that
 * list); anywhere else it opens All tasks in that layout.
 */
function showAs(layout: TaskLayout): (c: { navigate: typeof navigate }) => void {
  return (c) => {
    const segments = currentPath().split('/').filter(Boolean)
    if (segments[0] === 'tasks' && segments[1] === 'views') {
      setQuery({ layout })
      return
    }
    if (onTasksPage()) {
      // The remembered layout is written first, then the address, so the page re-renders with both.
      void Promise.all([import('@/logic/taskLists'), import('./views/LayoutSwitch')]).then(
        ([{ listFromParam }, { rememberLayout }]) => {
          const list: TaskListId = listFromParam(segments[1])
          rememberLayout(list, layout)
          // Written into the address even for the list, so the page re-renders whatever it showed before.
          setQuery({ layout })
        },
      )
      return
    }
    c.navigate('tasks', { list: 'all' }, { query: { layout } })
  }
}

const layoutCommands: CommandDef[] = [
  {
    id: 'command.tasks.layoutList',
    title: 'Show tasks as a list',
    group: 'View',
    icon: List,
    keywords: ['layout', 'rows'],
    shortcutId: 'tasks.layoutList',
    run: showAs('list'),
  },
  {
    id: 'command.tasks.layoutBoard',
    title: 'Show tasks as a board',
    group: 'View',
    icon: Columns3,
    keywords: ['layout', 'kanban', 'columns', 'todo', 'doing', 'done'],
    shortcutId: 'tasks.layoutBoard',
    run: showAs('board'),
  },
  {
    id: 'command.tasks.layoutCalendar',
    title: 'Show tasks as a calendar',
    group: 'View',
    icon: CalendarDays,
    keywords: ['layout', 'week', 'schedule', 'reschedule'],
    shortcutId: 'tasks.layoutCalendar',
    run: showAs('calendar'),
  },
  {
    id: 'command.tasks.saveView',
    title: 'Save this view',
    group: 'View',
    icon: BookmarkPlus,
    keywords: ['saved view', 'filter', 'bookmark'],
    shortcutId: 'tasks.saveView',
    when: canSaveHere,
    run: (c) => c.invoke('tasks.saveView'),
  },
]

const manifest: FeatureManifest = {
  id: 'tasks',
  routes: {
    tasks: TasksPage,
    taskView: TasksPage,
    task: lazy(() => import('./TaskPage')),
  },
  shortcuts: [
    ...taskShortcuts,
    ...viewShortcuts,
    {
      id: 'tasks.acceptSlots',
      keys: 'shift+a',
      description: 'Accept all suggested times',
      group: 'Tasks',
      scope: 'global',
    },
  ],
  commands: [
    {
      id: 'command.tasks.completed',
      title: 'Go to Completed tasks',
      group: 'Go to',
      icon: CircleCheckBig,
      keywords: ['done', 'finished', 'history'],
      run: (c) => c.navigate('tasks', { list: 'completed' }),
    },
    {
      id: 'command.tasks.acceptSlots',
      title: 'Accept suggested times',
      group: 'Create',
      icon: CalendarClock,
      keywords: ['auto', 'schedule', 'slot', 'suggest', 'deadline'],
      shortcutId: 'tasks.acceptSlots',
      // The suggestions card owns the handler. Wherever it is mounted (Inbox, Upcoming, Today) it accepts;
      // anywhere else the command takes the person to Upcoming and brings the card into view.
      run: (c) => {
        if (isSuggestionsCardMounted()) c.invoke('tasks.acceptSlots')
        else openSuggestionsCard(() => c.navigate('tasks', { list: 'upcoming' }))
      },
    },
    ...layoutCommands,
  ],
  search: [taskSearch],
  slots: [
    { slot: 'sidebar.nav.tasks', id: 'saved-views', order: 10, component: SavedViewsNav },
    {
      slot: 'settings.sections',
      id: 'tasks.everydayHours',
      order: 20,
      component: EverydayHoursSection,
    },
  ],
}

export default manifest
