import type { ShortcutDef } from '@/app/registry'
import { RATINGS } from './moods'

/**
 * `1` to `5` rate the focus of the session that just ended, while its end dialog is open (the `modal`
 * scope; the keys are bound only while the check-in is on screen, so they do nothing in other dialogs and
 * are quiet while typing a note). One entry per key, which the "?" sheet shows as one row.
 */
export const checkInShortcuts: ShortcutDef[] = RATINGS.map((n) => ({
  id: `checkins.rate.${n}`,
  keys: String(n),
  description: 'Rate your focus after a session (1 to 5)',
  group: 'Focus',
  scope: 'modal',
}))
