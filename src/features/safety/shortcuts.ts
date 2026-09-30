import type { ShortcutDef } from '@/app/registry'
import { requestSnapshotNow } from './commandBus'

const group = 'Trash'
const scope = 'trash'

/**
 * The Trash page's keys (scope `trash`, on the stack only while the page is open). `j` and `k` move through
 * the list, `r` restores the current item, `mod+backspace` asks to delete it forever, `shift+e` empties the
 * Trash and `f` goes to the search field. The page binds behaviour with `useShortcutHandler`.
 */
export const trashPageShortcuts: ShortcutDef[] = [
  { id: 'trash.next', keys: 'j', description: 'Select the next item', group, scope },
  { id: 'trash.prev', keys: 'k', description: 'Select the previous item', group, scope },
  { id: 'trash.restore', keys: 'r', description: 'Restore the selected item', group, scope },
  {
    id: 'trash.delete',
    keys: 'mod+backspace',
    description: 'Delete the selected item forever',
    group,
    scope,
  },
  { id: 'trash.empty', keys: 'shift+e', description: 'Empty the Trash…', group, scope },
  { id: 'trash.search', keys: 'f', description: 'Search the Trash', group, scope },
]

/** Global keys of the safety net: open the Trash, and save a snapshot without leaving the page. */
export const safetyShortcuts: ShortcutDef[] = [
  {
    id: 'trash.open',
    keys: 'o t',
    description: 'Open the Trash',
    group: 'Data',
    scope: 'global',
    run: (c) => c.navigate('trash'),
  },
  {
    id: 'snapshot.now',
    keys: 'o s',
    description: 'Take a snapshot now',
    group: 'Data',
    scope: 'global',
    run: () => requestSnapshotNow(),
  },
  ...trashPageShortcuts,
]
