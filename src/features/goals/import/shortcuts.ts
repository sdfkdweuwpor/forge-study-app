import type { ShortcutDef } from '@/app/registry'

/**
 * `i` opens the import on a goal page (PLAN §5.2). It is bound by `ImportPanel` while the panel is on
 * screen, so it does nothing elsewhere. `mod+enter` inside the flow (next step) is handled by the
 * editor itself, because the shortcut engine keeps single-purpose global keys out of text fields.
 */
export const importShortcuts: ShortcutDef[] = [
  {
    id: 'goals.import',
    keys: 'i',
    description: 'Import plan from Claude',
    group: 'Goals',
    scope: 'goal',
  },
]
