import { ShieldPlus } from 'lucide-react'
import { lazy } from 'react'
import type { FeatureManifest } from '@/app/registry'
import { seedDefaultBlocklist } from '@/db/repos/blocker'
import { BlockerSync } from './BlockerSync'
import { blockerShortcuts } from './shortcuts'

// Slot components load on demand (Suspense in the slot host renders nothing meanwhile), so the eager
// manifest stays small: only the sync provider is in the initial bundle.
const TodayCard = lazy(() => import('./TodayCard').then((m) => ({ default: m.TodayCard })))
const BlockedAttempts = lazy(() =>
  import('./ProgressSections').then((m) => ({ default: m.BlockedAttemptsSection })),
)
const UnlockLog = lazy(() =>
  import('./ProgressSections').then((m) => ({ default: m.UnlockLogSection })),
)

/**
 * The site blocker (BRIEF §5.8): the `/blocker` page, the sync provider that keeps the Chrome
 * extension in step with the app (config, focus session, events), a "Distractions blocked today" card
 * on Today, and the blocked-attempts and emergency-unlock sections on Progress. "Go to Blocker" and
 * `g b` come from the shell.
 */
const manifest: FeatureManifest = {
  id: 'blocker',
  routes: { blocker: lazy(() => import('./BlockerPage')) },
  shortcuts: blockerShortcuts,
  commands: [
    {
      id: 'command.blocker.addSite',
      title: 'Add site to blocklist',
      group: 'Create',
      icon: ShieldPlus,
      keywords: ['block', 'website', 'distraction', 'domain', 'instagram', 'youtube', 'reddit'],
      shortcutId: 'blocker.addSite',
      // On the Blocker page `a` does this; from anywhere else the page opens with the field focused.
      run: (c) => c.navigate('blocker', undefined, { query: { add: '1' } }),
    },
  ],
  providers: [{ order: 70, component: BlockerSync }],
  slots: [
    { slot: 'today.aside', id: 'blocker.todayCard', order: 40, component: TodayCard },
    {
      slot: 'progress.sections',
      id: 'blocker.progress.attempts',
      order: 80,
      component: BlockedAttempts,
    },
    { slot: 'progress.sections', id: 'blocker.progress.unlocks', order: 90, component: UnlockLog },
  ],
  onAppStart: async () => {
    await seedDefaultBlocklist()
  },
}

export default manifest
