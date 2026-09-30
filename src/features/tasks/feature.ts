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
import { navigate, setQuery } from '@/app/router'
import { dayOf } from '@/logic/dates'
import { relativeDay } from '@/logic/taskDisplay'
import { listFromParam, type TaskListId } from '@/logic/taskLists'
import { searchTasks } from './queries'
import { SavedViewsNav } from './SavedViewsNav'
import { taskShortcuts } from './shortcuts'
import { rememberLayout } from './views/LayoutSwitch'
import { viewShortcuts } from './views/viewShortcuts'
import { canSaveView, type TaskLayout } from '@/logic/taskViews'

/** Palette search over task titles, notes, checklists and tags. Choosing a result opens the task's page. */
const taskSearch: SearchProvider = {
  id: 'tasks',
  group: 'Tasks',
  async search(query, limit) {
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

/** Both routes are one page: `/tasks/views/:viewId` is the Tasks screen showing a saved view. */
const TasksPage = lazy(() => import('./TasksPage'))

const onTasksPage = (): boolean => window.location.pathname.startsWith('/tasks')

/** Saved views cover open tasks, so Completed has nothing to save. */
const canSaveHere = (): boolean => {
  if (!onTasksPage()) return false
  const [, second] = window.location.pathname.split('/').filter(Boolean)
  return second === 'views' || canSaveView(listFromParam(second))
}

/**
 * "Show tasks as a board": on a Tasks page it changes the layout in place (and remembers it for that
 * list); anywhere else it opens All tasks in that layout.
 */
function showAs(layout: TaskLayout): (c: { navigate: typeof navigate }) => void {
  return (c) => {
    const segments = window.location.pathname.split('/').filter(Boolean)
    if (segments[0] === 'tasks' && segments[1] === 'views') {
      setQuery({ layout })
      return
    }
    if (onTasksPage()) {
      const list: TaskListId = listFromParam(segments[1])
      rememberLayout(list, layout)
      // Written into the address even for the list, so the page re-renders whatever it showed before.
      setQuery({ layout })
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
      // The suggestions card owns the handler; away from it, open Upcoming where the card sits.
      run: (c) => {
        const path = window.location.pathname
        if (onTasksPage() || path === '/' || path.startsWith('/today')) c.invoke('tasks.acceptSlots')
        else c.navigate('tasks', { list: 'upcoming' })
      },
    },
    ...layoutCommands,
  ],
  search: [taskSearch],
  slots: [{ slot: 'sidebar.nav.tasks', id: 'saved-views', order: 10, component: SavedViewsNav }],
}

export default manifest
