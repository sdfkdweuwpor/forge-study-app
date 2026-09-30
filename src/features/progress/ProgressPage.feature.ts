import { ChartColumn } from 'lucide-react'
import { lazy } from 'react'
import type { CommandDef, ShortcutDef } from '@/app/registry'
import type { FeatureContribution } from './feature'

/**
 * The Progress page (7B): `/progress` with its charts. `g p` (built in) goes there. On the page, `v g`
 * and `v c` switch "Time per goal" between goals and courses (the address holds the choice, `?by=course`),
 * and both are palette commands that work from anywhere.
 */
const shortcuts: ShortcutDef[] = [
  {
    id: 'progress.byGoal',
    keys: 'v g',
    description: 'Show time per goal',
    group: 'Progress',
    scope: 'progress',
  },
  {
    id: 'progress.byCourse',
    keys: 'v c',
    description: 'Show time per course',
    group: 'Progress',
    scope: 'progress',
  },
]

const commands: CommandDef[] = [
  {
    id: 'command.progress.byGoal',
    title: 'Show time per goal',
    group: 'View',
    icon: ChartColumn,
    keywords: ['chart', 'goals', 'time', 'hours'],
    shortcutId: 'progress.byGoal',
    run: (c) => c.navigate('progress'),
  },
  {
    id: 'command.progress.byCourse',
    title: 'Show time per course',
    group: 'View',
    icon: ChartColumn,
    keywords: ['chart', 'courses', 'C182', 'C779', 'D278', 'time', 'hours'],
    shortcutId: 'progress.byCourse',
    run: (c) => c.navigate('progress', undefined, { query: { by: 'course' } }),
  },
]

const feature: FeatureContribution = {
  routes: { progress: lazy(() => import('./ProgressPage')) },
  shortcuts,
  commands,
}

export default feature
