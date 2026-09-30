import { lazy } from 'react'
import type { FeatureManifest } from '@/app/registry'
import { ritualCommands } from './commands'
import { RitualPrompt } from './TodayPrompt'
import { ritualShortcuts } from './shortcuts'
import { Top3Card } from './Top3Card'

// The dialogs, the Settings sections and the Progress card are not needed for the first paint.
const RitualRoute = lazy(() => import('./RitualRoute'))
const RitualsHost = lazy(() => import('./RitualsHost').then((m) => ({ default: m.RitualsHost })))
const RitualsSection = lazy(() =>
  import('./RitualsSettings').then((m) => ({ default: m.RitualsSection })),
)
const RoutinesSection = lazy(() =>
  import('./RoutinesSettings').then((m) => ({ default: m.RoutinesSection })),
)
const ReflectionsSection = lazy(() =>
  import('./ReflectionsSection').then((m) => ({ default: m.ReflectionsSection })),
)

/**
 * Daily rituals (Phase 11g, BRIEF §5.11) and the routine task templates the morning plan uses (the small
 * part of Phase 11i).
 *
 * - Morning plan: a three-step dialog (top 3, today's goal work, the daily goal). The top 3 is pinned on
 *   Today.
 * - Evening shutdown: a three-step dialog (done today, move what is open, one line). Completing pays +10 XP
 *   once a day.
 * - Routines: named sets of tasks (`Template`, kind `task`) added to a day in one click; two starters.
 *
 * Entry points: the palette ("Morning plan", "Evening shutdown", "Add routine…"), `w m`, `w e` and `w r`, a gentle
 * card on Today (morning before noon, evening from 17:00, both times in Settings, dismissible for the day),
 * the `/rituals/:kind` link, and Settings.
 *
 * Slots: `today.header` (prompt 40, Top 3 45), `global.overlays` (host 60), `progress.sections`
 * (reflections 60), `settings.sections` (rituals 35, routines 36).
 */
const manifest: FeatureManifest = {
  id: 'rituals',
  routes: { ritual: RitualRoute },
  shortcuts: ritualShortcuts,
  commands: ritualCommands,
  slots: [
    { slot: 'today.header', id: 'rituals.prompt', order: 40, component: RitualPrompt },
    { slot: 'today.header', id: 'rituals.top3', order: 45, component: Top3Card },
    { slot: 'global.overlays', id: 'rituals.host', order: 60, component: RitualsHost },
    {
      slot: 'progress.sections',
      id: 'rituals.reflections',
      order: 60,
      component: ReflectionsSection,
    },
    { slot: 'settings.sections', id: 'rituals', order: 35, component: RitualsSection },
    { slot: 'settings.sections', id: 'routines', order: 36, component: RoutinesSection },
  ],
}

export default manifest
