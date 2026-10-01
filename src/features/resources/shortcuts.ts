import type { ShortcutDef } from '@/app/registry'

/**
 * `a` on a course page opens the "Add a resource" menu (link, PDF or note). It lives in the `course` scope,
 * like the page's other keys (`n` adds a unit), and the panel binds it, so it only does something while the
 * course page is open. The palette's three "Add …" commands call the same panel through handlers with no key.
 */
export const resourceShortcuts: ShortcutDef[] = [
  {
    id: 'resources.add',
    keys: 'a',
    description: 'Add a resource (link, PDF or note)',
    group: 'Goals',
    scope: 'course',
  },
]
