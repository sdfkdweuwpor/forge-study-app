import type { FeatureManifest } from '@/app/registry'
import { BestHoursCard } from './BestHoursCard'
import { CheckInPrompt } from './CheckInPrompt'
import { checkInShortcuts } from './shortcuts'

/**
 * Focus check-ins (Phase 11b, BRIEF §5.11). After a session, a one-line "How was your focus?" (1 to 5,
 * keys 1 to 5, then an optional mood) in the end dialog; Progress shows the hours and weekdays you focus
 * best once there are enough ratings; and the best hour is written to `settings.scheduling.bestHour`,
 * which the planner uses to start each day's first study session (`db/repos/checkins.ts`).
 *
 * Slots: `focus.afterSession` (order 30, after the parking list) and `progress.sections` (order 50).
 * There is no palette command: rating is part of ending a session, and the ratings are skippable.
 */
const manifest: FeatureManifest = {
  id: 'checkins',
  shortcuts: checkInShortcuts,
  slots: [
    { slot: 'focus.afterSession', id: 'checkins.prompt', order: 30, component: CheckInPrompt },
    { slot: 'progress.sections', id: 'checkins.bestHours', order: 50, component: BestHoursCard },
  ],
}

export default manifest
