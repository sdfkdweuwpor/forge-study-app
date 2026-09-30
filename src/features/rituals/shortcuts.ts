import type { ShortcutDef } from '@/app/registry'
import { openRitualDialog } from './store'

/**
 * Two global chords on a prefix of their own, `w`: `w m` opens the morning plan and `w e` the evening
 * shutdown. Nothing else in the app starts with `w` (the go-to chords start with `g`), so neither can shadow
 * a single key on any page. Like every global key they stay quiet while a dialog or the palette is open.
 */
export const ritualShortcuts: ShortcutDef[] = [
  {
    id: 'rituals.morning',
    keys: 'w m',
    description: 'Open the morning plan',
    group: 'Today',
    scope: 'global',
    run: () => openRitualDialog('morning'),
  },
  {
    id: 'rituals.evening',
    keys: 'w e',
    description: 'Open the evening shutdown',
    group: 'Today',
    scope: 'global',
    run: () => openRitualDialog('evening'),
  },
]
