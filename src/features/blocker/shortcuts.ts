import type { ShortcutDef } from '@/app/registry'

/**
 * The Blocker page's keyboard map. `a` jumps to the "add a site" field; it only exists while the page
 * is on screen (scope `blocker`) and the page binds it with `useShortcutHandler`. Going to the page is
 * the shell's `g b`.
 */
export const blockerShortcuts: ShortcutDef[] = [
  {
    id: 'blocker.addSite',
    keys: 'a',
    description: 'Add a site to the blocklist',
    group: 'Blocker',
    scope: 'blocker',
  },
]
