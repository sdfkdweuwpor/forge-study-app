import { Moon, PanelLeft, Zap } from 'lucide-react'
import { toggleReducedMotion, toggleTheme } from '../providers/themeActions'
import type { CommandDef, FeatureManifest, ShortcutDef } from './types'
import type { RouteArgs, RouteName } from '../router/routes'

/** The shell's own shortcuts and commands. Registered like any feature so the "?" sheet and palette list them. */

interface GoTo {
  keys: string
  title: string
  route: RouteName
  params?: Record<string, string>
}

const GO_TO: GoTo[] = [
  { keys: 'g t', title: 'Today', route: 'today' },
  { keys: 'g f', title: 'Focus', route: 'focus' },
  { keys: 'g i', title: 'Inbox', route: 'tasks', params: { list: 'inbox' } },
  { keys: 'g u', title: 'Upcoming', route: 'tasks', params: { list: 'upcoming' } },
  { keys: 'g a', title: 'All tasks', route: 'tasks', params: { list: 'all' } },
  { keys: 'g g', title: 'Goals', route: 'goals' },
  { keys: 'g w', title: 'My World', route: 'world' },
  { keys: 'g p', title: 'Progress', route: 'progress' },
  { keys: 'g r', title: 'Rewards', route: 'rewards' },
  { keys: 'g b', title: 'Blocker', route: 'blocker' },
  { keys: 'g s', title: 'Settings', route: 'settings' },
]

const goToId = (route: RouteName, params?: Record<string, string>) =>
  `go.${route}${params?.list ? `.${params.list}` : ''}`

const goShortcuts: ShortcutDef[] = GO_TO.map((g) => ({
  id: goToId(g.route, g.params),
  keys: g.keys,
  description: `Go to ${g.title}`,
  group: 'Navigation',
  scope: 'global',
  run: (c) => {
    const args = [g.params] as unknown as RouteArgs<'goals', never>
    c.navigate(g.route as 'goals', ...args)
  },
}))

const goCommands: CommandDef[] = GO_TO.map((g) => ({
  id: `command.${goToId(g.route, g.params)}`,
  title: `Go to ${g.title}`,
  group: 'Go to',
  keywords: ['open', 'navigate', g.title.toLowerCase()],
  shortcutId: goToId(g.route, g.params),
  run: (c) => {
    const args = [g.params] as unknown as RouteArgs<'goals', never>
    c.navigate(g.route as 'goals', ...args)
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
    },
    {
      id: 'app.escape',
      keys: 'esc',
      description: 'Close overlay or exit full-screen',
      group: 'General',
      scope: 'global',
      allowInInputs: true,
    },
    ...goShortcuts,
  ],
  commands: [
    ...goCommands,
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
      run: () => toggleTheme(),
    },
    {
      id: 'command.toggleReducedMotion',
      title: 'Toggle reduced motion',
      group: 'View',
      icon: Zap,
      keywords: ['animation', 'accessibility', 'motion'],
      run: () => toggleReducedMotion(),
    },
  ],
}
