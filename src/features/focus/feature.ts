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
 * timers and the full-screen view all read it. The sound feature's pieces (4B) plug in here: the sound panel in the aside, the mini player, the notification ask after a session, the settings section.
 */
// Pieces that only show on the Focus page, in the end dialog or in Settings load when they are first drawn.
const SoundPanel = lazy(() => import('./sound/SoundPanel').then((m) => ({ default: m.SoundPanel })))
const MiniPlayer = lazy(() => import('./sound/MiniPlayer').then((m) => ({ default: m.MiniPlayer })))
const MobilePlayer = lazy(() =>
  import('./sound/MiniPlayer').then((m) => ({ default: m.MobilePlayer })),
)
const NotifyPrompt = lazy(() =>
  import('./sound/NotifyPrompt').then((m) => ({ default: m.NotifyPrompt })),
)
const SoundHost = lazy(() => import('./sound/SoundHost').then((m) => ({ default: m.SoundHost })))
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
    { slot: 'global.overlays', id: 'focus.soundHost', order: 40, component: SoundHost },
    { slot: 'sidebar.footer', id: 'focus.miniPlayer', order: 30, component: MiniPlayer },
    { slot: 'global.overlays', id: 'focus.mobilePlayer', order: 35, component: MobilePlayer },
    { slot: 'focus.aside', id: 'focus.sound', order: 10, component: SoundPanel },
    { slot: 'focus.afterSession', id: 'focus.notifyPrompt', order: 10, component: NotifyPrompt },
    { slot: 'settings.sections', id: 'focus.sound', order: 30, component: SoundSection },
  ],
}

export default manifest
