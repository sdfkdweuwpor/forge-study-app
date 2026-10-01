import type { ShortcutDef } from '@/app/registry'

/**
 * `p` parks a thought (BRIEF §5.11). It works on the Focus page (`focus` scope) and in full-screen focus
 * (`fullscreen` scope, a blocking scope, so it is its own entry), and from anywhere while a focus session
 * runs (the mini timer is on every other page). `ParkingHost` binds all three to the same popover; the
 * last one is bound only while a session runs, so `p` does nothing on other pages otherwise.
 */
export const parkingShortcuts: ShortcutDef[] = [
  {
    id: 'parking.open',
    keys: 'p',
    description: 'Park a thought',
    group: 'Focus',
    scope: 'focus',
  },
  {
    id: 'parking.open.fullscreen',
    keys: 'p',
    description: 'Park a thought',
    group: 'Full-screen focus',
    scope: 'fullscreen',
  },
  {
    id: 'parking.open.session',
    keys: 'p',
    description: 'Park a thought while a session runs',
    group: 'Focus',
    scope: 'global',
  },
]
