import { CircleCheckBig, ListChecks } from 'lucide-react'
import { lazy } from 'react'
import type { FeatureManifest, SearchProvider } from '@/app/registry'
import { dayOf } from '@/logic/dates'
import { relativeDay } from '@/logic/taskDisplay'
import { searchTasks } from './queries'
import { taskShortcuts } from './shortcuts'

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

const manifest: FeatureManifest = {
  id: 'tasks',
  routes: {
    tasks: lazy(() => import('./TasksPage')),
    task: lazy(() => import('./TaskPage')),
  },
  shortcuts: taskShortcuts,
  commands: [
    {
      id: 'command.tasks.completed',
      title: 'Go to Completed tasks',
      group: 'Go to',
      icon: CircleCheckBig,
      keywords: ['done', 'finished', 'history'],
      run: (c) => c.navigate('tasks', { list: 'completed' }),
    },
  ],
  search: [taskSearch],
}

export default manifest
