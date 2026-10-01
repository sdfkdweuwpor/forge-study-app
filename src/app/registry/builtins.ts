import { Moon, PanelLeft, Undo2, Zap } from 'lucide-react'
import { toggleReducedMotion, toggleTheme } from '../providers/themeActions'
import { recordError } from '../reportError'
import { href, navigateToUrl } from '../router/router'
import { UndoHost } from '../UndoHost'
import { canUndoNow } from '../undoProbe'
import type { CommandDef, FeatureManifest, ShortcutDef } from './types'

/** The shell's own shortcuts and commands. Registered like any feature so the "?" sheet and palette list them. */

interface GoTo {
  /** Shortcut id; the command id is `command.${id}`. */
  id: string
  keys: string
  title: string
  /** Built with `href()`, so the route name and its params are type-checked where they are written. */
  url: string
}

const GO_TO: readonly GoTo[] = [
  { id: 'go.today', keys: 'g t', title: 'Today', url: href('today') },
  { id: 'go.focus', keys: 'g f', title: 'Focus', url: href('focus') },
  { id: 'go.tasks.inbox', keys: 'g i', title: 'Inbox', url: href('tasks', { list: 'inbox' }) },
  {
    id: 'go.tasks.upcoming',
    keys: 'g u',
    title: 'Upcoming',
    url: href('tasks', { list: 'upcoming' }),
  },
  { id: 'go.tasks.all', keys: 'g a', title: 'All tasks', url: href('tasks', { list: 'all' }) },
  { id: 'go.goals', keys: 'g g', title: 'Goals', url: href('goals') },
  { id: 'go.world', keys: 'g w', title: 'My World', url: href('world') },
  { id: 'go.progress', keys: 'g p', title: 'Progress', url: href('progress') },
  { id: 'go.rewards', keys: 'g r', title: 'Rewards', url: href('rewards') },
  { id: 'go.blocker', keys: 'g b', title: 'Blocker', url: href('blocker') },
  { id: 'go.settings', keys: 'g s', title: 'Settings', url: href('settings') },
]

const goShortcuts: ShortcutDef[] = GO_TO.map((g) => ({
  id: g.id,
  keys: g.keys,
  description: `Go to ${g.title}`,
  group: 'Navigation',
  scope: 'global',
  run: () => {
    navigateToUrl(g.url)
  },
}))

const goCommands: CommandDef[] = GO_TO.map((g) => ({
  id: `command.${g.id}`,
  title: `Go to ${g.title}`,
  group: 'Go to',
  keywords: ['open', 'navigate', g.title.toLowerCase()],
  shortcutId: g.id,
  run: () => {
    navigateToUrl(g.url)
  },
}))

export const builtins: FeatureManifest = {
  id: 'app',
  shortcuts: [
    {
      id: 'app.toggleSidebar',
      keys: 'mod+\\',
      description: 'Toggle sidebar',
      group: 'General',
      scope: 'global',
      allowInInputs: true,
      // Only the drawer needs it: on a tablet it is how the drawer is closed again.
      allowInOverlays: ['drawer'],
    },
    {
      id: 'app.undo',
      keys: 'mod+z',
      description: 'Undo last action',
      group: 'General',
      scope: 'global',
      // Not in inputs: there the key is the field's own text undo (`allowInInputs` stays off). The handler
      // is bound by `UndoHost`, which reaches the toast that offers the Undo.
    },
    {
      id: 'app.escape',
      keys: 'esc',
      description: 'Close overlay or exit full-screen',
      group: 'General',
      scope: 'global',
      allowInInputs: true,
      allowInOverlays: true,
    },
    ...goShortcuts,
  ],
  slots: [{ slot: 'global.overlays', id: 'app.undo', order: 5, component: UndoHost }],
  commands: [
    ...goCommands,
    {
      id: 'command.undo',
      title: 'Undo',
      group: 'Data',
      icon: Undo2,
      keywords: ['revert', 'take back', 'last action', 'restore'],
      shortcutId: 'app.undo',
      // Listed only while a toast on screen still offers an Undo.
      when: () => canUndoNow(),
      run: (c) => c.invoke('app.undo'),
    },
    {
      id: 'command.toggleSidebar',
      title: 'Toggle sidebar',
      group: 'View',
      icon: PanelLeft,
      keywords: ['collapse', 'expand', 'navigation'],
      shortcutId: 'app.toggleSidebar',
      run: (c) => c.invoke('app.toggleSidebar'),
    },
    {
      id: 'command.toggleTheme',
      title: 'Toggle theme',
      group: 'View',
      icon: Moon,
      keywords: ['dark', 'light', 'appearance'],
      run: () => toggleTheme().catch((e: unknown) => recordError(e, 'toggleTheme')),
    },
    {
      id: 'command.toggleReducedMotion',
      title: 'Toggle reduced motion',
      group: 'View',
      icon: Zap,
      keywords: ['animation', 'accessibility', 'motion'],
      run: () => toggleReducedMotion().catch((e: unknown) => recordError(e, 'toggleReducedMotion')),
    },
  ],
}
