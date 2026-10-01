import type { ShortcutDef } from '@/app/registry'

const group = 'Onboarding'

/**
 * The first-launch flow's keys. They are `global` (the page has no scope of its own) but only do
 * something while `/welcome` is on screen: the page binds them with `useShortcutHandler`. Enter also
 * continues, because each step is a form. Going back to a step never loses what was typed.
 */
export const onboardingShortcuts: ShortcutDef[] = [
  {
    id: 'onboarding.next',
    keys: 'alt+right',
    description: 'Onboarding: continue to the next step',
    group,
    scope: 'global',
    allowInInputs: true,
  },
  {
    id: 'onboarding.back',
    keys: 'alt+left',
    description: 'Onboarding: back to the previous step',
    group,
    scope: 'global',
    allowInInputs: true,
  },
  {
    id: 'onboarding.skipStep',
    keys: 'alt+shift+right',
    description: 'Onboarding: skip this step',
    group,
    scope: 'global',
    allowInInputs: true,
  },
  {
    id: 'onboarding.skipSetup',
    keys: 'alt+shift+s',
    description: 'Onboarding: skip setup',
    group,
    scope: 'global',
    allowInInputs: true,
  },
]
