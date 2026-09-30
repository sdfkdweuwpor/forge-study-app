import type { FeatureManifest } from '@/app/registry'
import { parkingCommands } from './commands'
import { FocusParking } from './FocusAside'
import { ParkingHost } from './ParkingHost'
import { SessionParked } from './SessionParked'
import { SidebarPark } from './SidebarPark'
import { parkingShortcuts } from './shortcuts'
import { ParkedTodayCard } from './TodayCard'

/**
 * The distraction parking lot (Phase 11a, BRIEF §5.11). A thought or urge typed during focus is saved for
 * later instead of acted on: `p` opens a tiny input (Focus page, full-screen focus, or any page while a
 * session runs), "Park a thought" is in the palette, and what was parked is sorted afterwards from the
 * end-of-session dialog or the Today card (convert to task, done, delete, each with Undo).
 *
 * Slots: `global.overlays` (the popover, order 50), `focus.afterSession` (order 20, before the check-in),
 * `focus.aside`, `sidebar.timer` and `today.aside` (order 40, last).
 */
const manifest: FeatureManifest = {
  id: 'parking',
  shortcuts: parkingShortcuts,
  commands: parkingCommands,
  slots: [
    { slot: 'global.overlays', id: 'parking.host', order: 50, component: ParkingHost },
    { slot: 'focus.afterSession', id: 'parking.session', order: 20, component: SessionParked },
    { slot: 'focus.aside', id: 'parking.aside', order: 20, component: FocusParking },
    { slot: 'sidebar.timer', id: 'parking.sidebar', order: 20, component: SidebarPark },
    { slot: 'today.aside', id: 'parking.today', order: 40, component: ParkedTodayCard },
  ],
}

export default manifest
