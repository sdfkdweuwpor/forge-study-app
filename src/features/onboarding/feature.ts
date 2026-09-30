import { Sparkles, SkipForward } from 'lucide-react'
import { lazy } from 'react'
import type { FeatureManifest } from '@/app/registry'
import { isWelcomePath } from '@/logic/onboarding'
import { OnboardingGate } from './OnboardingGate'
import { onboardingShortcuts } from './shortcuts'

/**
 * Onboarding (BRIEF §5.10): the first-launch flow on `/welcome`, and the gate that sends a brand-new
 * person there. The gate is a provider (first, so it wraps everything); the page is lazy, so the flow
 * costs nothing after the first launch. "Replay onboarding" runs it again from the palette.
 */
const manifest: FeatureManifest = {
  id: 'onboarding',
  routes: { welcome: lazy(() => import('./WelcomePage')) },
  providers: [{ order: 1, component: OnboardingGate }],
  shortcuts: onboardingShortcuts,
  commands: [
    {
      id: 'command.onboarding.replay',
      title: 'Replay onboarding',
      group: 'Help',
      icon: Sparkles,
      keywords: ['welcome', 'setup', 'set up', 'tour', 'intro', 'getting started', 'first run'],
      // Already there: nothing to replay.
      when: () => !isWelcomePath(window.location.pathname),
      run: (c) => c.navigate('welcome'),
    },
    {
      id: 'command.onboarding.skipSetup',
      title: 'Skip setup',
      group: 'Help',
      icon: SkipForward,
      keywords: ['onboarding', 'welcome', 'later', 'close', 'leave'],
      shortcutId: 'onboarding.skipSetup',
      when: () => isWelcomePath(window.location.pathname),
      run: (c) => c.invoke('onboarding.skipSetup'),
    },
  ],
}

export default manifest
