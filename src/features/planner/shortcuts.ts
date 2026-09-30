import type { ShortcutDef } from '@/app/registry'

const group = 'Planner'

/**
 * Planner keys. `alt+enter` and `alt+shift+enter` move through the new-goal steps from anywhere on the
 * page, text fields included (`mod+enter` is Quick add). The others belong to a goal page: re-plan the
 * week ("life happened"), jump to the pending proposals, open Plan settings. They are bound by the
 * planner's goal-page header, so they only do something while a goal page is open.
 */
export const plannerShortcuts: ShortcutDef[] = [
  {
    id: 'planner.next',
    keys: 'alt+enter',
    description: 'New goal: continue to the next step (or create)',
    group,
    scope: 'global',
    allowInInputs: true,
  },
  {
    id: 'planner.back',
    keys: 'alt+shift+enter',
    description: 'New goal: back to the previous step',
    group,
    scope: 'global',
    allowInInputs: true,
  },
  {
    id: 'planner.lifeHappened',
    keys: 'shift+r',
    description: 'Life happened: re-plan this week',
    group,
    scope: 'goal',
  },
  {
    id: 'planner.reviewProposals',
    keys: 'shift+p',
    description: 'Review plan proposals',
    group,
    scope: 'goal',
  },
  {
    id: 'planner.settings',
    keys: 'shift+e',
    description: 'Open plan settings',
    group,
    scope: 'goal',
  },
]
