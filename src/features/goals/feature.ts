import { BookOpen, Check, Plus, Target } from 'lucide-react'
import { lazy } from 'react'
import type { CommandDef, FeatureManifest, SearchProvider } from '@/app/registry'
import { recordError } from '@/app/reportError'
import { currentPath } from '@/app/router'
import { defineHandler } from '@/db/events'
import { waitForStartupSync } from '@/db/repos/syncGate'
import { withPlanImport } from './import/manifest'
import { openNewGoalFlow } from './newGoal'
import { goalShortcuts } from './shortcuts'

/** The goal tree in the sidebar: its own chunk, fetched while the shell paints (app/bootPreload.ts). */
const GoalsNav = lazy(() => import('./GoalsNav').then((m) => ({ default: m.GoalsNav })))

/** Palette search over goal titles and course titles and codes ("c182", "web dev"). */
const goalSearch: SearchProvider = {
  id: 'goals',
  group: 'Goals',
  async search(query, limit) {
    const { searchGoals } = await import('./queries')
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
  /^\/goals\/[^/]+\/?$/.test(currentPath()) &&
  !currentPath().startsWith('/goals/new')
const onCoursePage = (): boolean =>
  /^\/goals\/[^/]+\/courses\/[^/]+\/?$/.test(currentPath())

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
 * Cloud sync (PLAN §4.7.5): two devices that both re-planned a goal offline each made a task for the same
 * plan item. After a pull, a goal with two open tasks for one plan item is re-planned once, which keeps
 * the older and removes the other (the same one on every device). Loaded on demand, like the planner.
 */
const healDuplicatePlans = defineHandler({
  id: 'goals.healDuplicatePlanTasks',
  event: 'sync.applied',
  async handle(event) {
    if (event.goalIds.length === 0) return
    const { healDuplicatePlanTasks } = await import('@/db/repos/syncHeal')
    await healDuplicatePlanTasks(event.goalIds)
  },
})

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
  domainHandlers: [healDuplicatePlans],
  // At the first open of a day, missed plan items roll forward (applied only when slightly behind;
  // far behind writes proposals instead). With cloud sync on, the roll-forward waits for the start-up
  // sync (up to 8 s), so the device opened second adopts the first one's roll-forward
  // (`lastDailyRunDay` syncs); with sync off the wait returns at once. Scheduled, not awaited:
  // `runAppStart` runs every feature's hook one after the other, and the sync feature's own hook starts
  // the engine, so a hook that waited here would hold the engine (and every feature after this one) back
  // until the wait timed out. Loaded on demand: the planner is not in the first chunk.
  onAppStart: async ({ now }) => {
    void (async () => {
      await waitForStartupSync(8000)
      const { runDailyPlanning } = await import('@/db/repos/proposals')
      await runDailyPlanning({ now })
    })().catch((error: unknown) => recordError(error, 'goals.dailyPlanning'))
  },
}

export default withPlanImport(manifest)
