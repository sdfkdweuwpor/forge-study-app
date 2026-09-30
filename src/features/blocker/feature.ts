import { ShieldPlus } from 'lucide-react'
import { Fragment, Suspense, createElement, lazy, useEffect, useState, type ReactNode } from 'react'
import type { FeatureManifest } from '@/app/registry'
import { whenIdle } from '@/lib/idle'
import { blockerShortcuts } from './shortcuts'

// Slot components load on demand (Suspense in the slot host renders nothing meanwhile), so the eager
// manifest stays small.
const TodayCard = lazy(() => import('./TodayCard').then((m) => ({ default: m.TodayCard })))
const BlockedAttempts = lazy(() =>
  import('./ProgressSections').then((m) => ({ default: m.BlockedAttemptsSection })),
)
const UnlockLog = lazy(() =>
  import('./ProgressSections').then((m) => ({ default: m.UnlockLogSection })),
)

const SyncRunner = lazy(() => import('./BlockerSync').then((m) => ({ default: m.SyncRunner })))

/**
 * Renders the app untouched and starts the extension sync a moment after the first screen. The sync
 * (config, focus session, events) needs the blocker repository, the extension protocol and the sync
 * engine, none of which the first screen does; it is silent when the extension is not installed.
 */
function BlockerSyncProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => whenIdle(() => setReady(true), { delayMs: 400 }), [])
  return createElement(
    Fragment,
    null,
    children,
    ready ? createElement(Suspense, { fallback: null }, createElement(SyncRunner)) : null,
  )
}

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
  providers: [{ order: 70, component: BlockerSyncProvider }],
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
    const { seedDefaultBlocklist } = await import('@/db/repos/blocker')
    await seedDefaultBlocklist()
  },
}

export default manifest
