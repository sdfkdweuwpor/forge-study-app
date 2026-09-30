import { BookOpen, Check, Plus, Target } from 'lucide-react'
import { lazy } from 'react'
import type { CommandDef, FeatureManifest, SearchProvider } from '@/app/registry'
import { GoalsNav } from './GoalsNav'
import { withPlanImport } from './import'
import { openNewGoalFlow } from './newGoal'
import { searchGoals } from './queries'
import { goalShortcuts } from './shortcuts'

/** Palette search over goal titles and course titles and codes ("c182", "web dev"). */
const goalSearch: SearchProvider = {
  id: 'goals',
  group: 'Goals',
  async search(query, limit) {
    const hits = await searchGoals(query, limit)
    return hits.map((hit) => ({
      id: `${hit.kind}:${hit.courseId ?? hit.goalId}`,
      title: hit.title,
      subtitle: hit.subtitle,
      icon: hit.kind === 'goal' ? Target : BookOpen,
      run: (c) =>
        hit.courseId === null
          ? c.navigate('goal', { goalId: hit.goalId })
          : c.navigate('course', { goalId: hit.goalId, courseId: hit.courseId }),
    }))
  },
}

const onGoalPage = (): boolean =>
  /^\/goals\/[^/]+\/?$/.test(window.location.pathname) &&
  !window.location.pathname.startsWith('/goals/new')
const onCoursePage = (): boolean =>
  /^\/goals\/[^/]+\/courses\/[^/]+\/?$/.test(window.location.pathname)

const commands: CommandDef[] = [
  {
    id: 'command.goals.new',
    title: 'New goal',
    group: 'Create',
    icon: Plus,
    keywords: ['create', 'degree', 'wgu', 'plan', 'planner', 'add goal'],
    shortcutId: 'goals.new',
    run: () => openNewGoalFlow(),
  },
  {
    id: 'command.goals.addCourse',
    title: 'Add a course',
    group: 'Goals',
    icon: Plus,
    keywords: ['course', 'milestone', 'class'],
    shortcutId: 'goals.addCourse',
    when: onGoalPage,
    run: (c) => c.invoke('goals.addCourse'),
  },
  {
    id: 'command.course.newUnit',
    title: 'Add a unit',
    group: 'Goals',
    icon: Plus,
    keywords: ['unit', 'chapter', 'section'],
    shortcutId: 'course.newUnit',
    when: onCoursePage,
    run: (c) => c.invoke('course.newUnit'),
  },
  {
    id: 'command.course.complete',
    title: 'Mark course complete',
    group: 'Goals',
    icon: Check,
    keywords: ['done', 'finish', 'course', 'pull forward'],
    shortcutId: 'course.complete',
    when: onCoursePage,
    run: (c) => c.invoke('course.complete'),
  },
]

/**
 * Goals (Phase 5B): the goals list, goal page and course page, the new-goal route (the planner), the
 * sidebar tree, palette search and commands. "Go to Goals" already exists in the app's own commands.
 * Other features add to a goal or course page through the `goal.header`, `goal.panels` and
 * `course.panels` slots; the import panel (5C) registers its `goal.panels` contribution in `slots` below.
 * `onAppStart` runs the daily plan roll-forward (schema v2).
 */
const manifest: FeatureManifest = {
  id: 'goals',
  routes: {
    goals: lazy(() => import('./GoalsPage')),
    // The new-goal flow is the goal breakdown planner (its index.ts default-exports the page).
    goalNew: lazy(() => import('@/features/planner')),
    goal: lazy(() => import('./GoalPage')),
    course: lazy(() => import('./CoursePage')),
  },
  shortcuts: goalShortcuts,
  commands,
  search: [goalSearch],
  slots: [{ slot: 'sidebar.nav.goals', id: 'goals.tree', order: 10, component: GoalsNav }],
  // At the first open of a day, missed plan items roll forward (applied only when slightly behind;
  // far behind writes proposals instead). Loaded on demand: the planner is not in the first chunk.
  onAppStart: async ({ now }) => {
    const { runDailyPlanning } = await import('@/db/repos/proposals')
    await runDailyPlanning({ now })
  },
}

export default withPlanImport(manifest)
