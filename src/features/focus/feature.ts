import { lazy } from 'react'
import type { FeatureManifest } from '@/app/registry'
import { focusCommands } from './commands'
import { FocusShortcuts } from './FocusShortcuts'
import { FullscreenOverlay } from './FullscreenOverlay'
import { MobileTimer, SidebarTimer } from './MiniTimer'
import { focusShortcuts } from './shortcuts'
import { soundCommands, soundShortcuts } from './sound/commands'
import { TimerProvider } from './TimerProvider'

/**
 * The focus timer (Phase 4). `TimerProvider` runs the clock for the whole app; the page, the mini
 * timers and the full-screen view all read it. The sound feature's pieces (4B) plug in here: ambient
 * control in the aside, the notification ask after a session, the settings section.
 */
// Pieces that only show on the Focus page, in the end dialog or in Settings load when they are first drawn.
const AmbientControl = lazy(() =>
  import('./sound/AmbientControl').then((m) => ({ default: m.AmbientControl })),
)
const NotifyPrompt = lazy(() =>
  import('./sound/NotifyPrompt').then((m) => ({ default: m.NotifyPrompt })),
)
const SoundSection = lazy(() =>
  import('./sound/SoundSection').then((m) => ({ default: m.SoundSection })),
)

const manifest: FeatureManifest = {
  id: 'focus',
  routes: { focus: lazy(() => import('./FocusPage')) },
  providers: [{ order: 50, component: TimerProvider }],
  shortcuts: [...focusShortcuts, ...soundShortcuts],
  commands: [...focusCommands, ...soundCommands],
  slots: [
    { slot: 'sidebar.timer', id: 'focus.miniTimer', order: 10, component: SidebarTimer },
    { slot: 'global.overlays', id: 'focus.shortcuts', order: 10, component: FocusShortcuts },
    { slot: 'global.overlays', id: 'focus.fullscreen', order: 20, component: FullscreenOverlay },
    { slot: 'global.overlays', id: 'focus.mobileTimer', order: 30, component: MobileTimer },
    { slot: 'focus.aside', id: 'focus.ambient', order: 10, component: AmbientControl },
    { slot: 'focus.afterSession', id: 'focus.notifyPrompt', order: 10, component: NotifyPrompt },
    { slot: 'settings.sections', id: 'focus.sound', order: 30, component: SoundSection },
  ],
}

export default manifest
