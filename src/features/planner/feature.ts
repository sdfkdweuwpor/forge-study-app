import { LifeBuoy, ListChecks, SlidersHorizontal } from 'lucide-react'
import { lazy } from 'react'
import type { CommandDef, FeatureManifest } from '@/app/registry'
import { currentPath } from '@/app/router'
import { plannerShortcuts } from './shortcuts'

// The goal page pieces (and the planner logic with them) load with the goal page, not with the app.
const PlanHeader = lazy(() => import('./goal/PlanHeader').then((m) => ({ default: m.PlanHeader })))

const onGoalPage = (): boolean =>
  /^\/goals\/[^/]+\/?$/.test(currentPath()) &&
  !currentPath().startsWith('/goals/new')

const commands: CommandDef[] = [
  {
    id: 'command.planner.lifeHappened',
    title: 'Life happened — re-plan this week',
    group: 'Goals',
    icon: LifeBuoy,
    keywords: ['replan', 're-plan', 'behind', 'sick', 'busy', 'missed', 'week', 'plan'],
    shortcutId: 'planner.lifeHappened',
    when: onGoalPage,
    run: (c) => c.invoke('planner.lifeHappened'),
  },
  {
    id: 'command.planner.reviewProposals',
    title: 'Review plan proposals',
    group: 'Goals',
    icon: ListChecks,
    keywords: ['behind', 'catch up', 'suggestions', 'options', 'roll forward'],
    shortcutId: 'planner.reviewProposals',
    when: onGoalPage,
    run: (c) => c.invoke('planner.reviewProposals'),
  },
  {
    id: 'command.planner.settings',
    title: 'Plan settings',
    group: 'Goals',
    icon: SlidersHorizontal,
    keywords: [
      'availability',
      'windows',
      'shift',
      'buffer',
      'session length',
      'target date',
      'schedule',
    ],
    shortcutId: 'planner.settings',
    when: onGoalPage,
    run: (c) => c.invoke('planner.settings'),
  },
]

/**
 * The Goal Breakdown Planner. The new-goal page itself (`/goals/new`) is the default export of this
 * folder's `index.ts`, which the goals feature lazy-loads for its `goalNew` route. This manifest adds
 * what the planner puts on a goal page (`goal.header`: pending proposals, "Life happened", Plan
 * settings), its commands and its shortcuts. "New goal" already exists in the goals feature.
 */
const manifest: FeatureManifest = {
  id: 'planner',
  commands,
  shortcuts: plannerShortcuts,
  slots: [{ slot: 'goal.header', id: 'planner.header', order: 10, component: PlanHeader }],
}

export default manifest
