import { Download, FileUp, Palette, RotateCcw, Timer } from 'lucide-react'
import { lazy } from 'react'
import type { CommandDef, FeatureManifest, ShortcutDef } from '@/app/registry'
import { requestBackupExport } from './commandBus'

// The host and the blocker link are small, but neither is needed for the first paint.
const SettingsHost = lazy(() => import('./SettingsHost').then((m) => ({ default: m.SettingsHost })))
const BlockerSection = lazy(() =>
  import('./BlockerSection').then((m) => ({ default: m.BlockerSection })),
)

const shortcuts: ShortcutDef[] = [
  {
    id: 'backup.export',
    keys: 'o b',
    description: 'Export all data (JSON backup)',
    group: 'Data',
    scope: 'global',
    run: () => requestBackupExport(),
  },
  {
    id: 'backup.import',
    keys: 'o r',
    description: 'Import data from a backup',
    group: 'Data',
    scope: 'global',
    run: (c) => c.navigate('settings', { section: 'data' }, { query: { do: 'import' } }),
  },
]

const commands: CommandDef[] = [
  {
    id: 'command.backup.export',
    title: 'Export all data (JSON backup)',
    group: 'Data',
    icon: Download,
    shortcutId: 'backup.export',
    keywords: ['backup', 'download', 'save', 'json', 'everything'],
    run: () => requestBackupExport(),
  },
  {
    id: 'command.backup.import',
    title: 'Import data from a backup…',
    group: 'Data',
    icon: FileUp,
    shortcutId: 'backup.import',
    keywords: ['restore', 'backup', 'upload', 'json', 'replace'],
    run: (c) => c.navigate('settings', { section: 'data' }, { query: { do: 'import' } }),
  },
  {
    id: 'command.backup.reset',
    title: 'Reset Forge…',
    group: 'Data',
    icon: RotateCcw,
    keywords: ['erase', 'wipe', 'delete everything', 'start over', 'clear data'],
    // Opens the confirmation; nothing is erased until the words are typed.
    run: (c) => c.navigate('settings', { section: 'data' }, { query: { do: 'reset' } }),
  },
  {
    id: 'command.settings.appearance',
    title: 'Change accent colour',
    group: 'View',
    icon: Palette,
    keywords: ['theme', 'color', 'appearance', 'dark', 'light', 'motion'],
    run: (c) => c.navigate('settings', { section: 'appearance' }),
  },
  {
    id: 'command.settings.timer',
    title: 'Timer defaults and daily goal',
    group: 'Focus',
    icon: Timer,
    keywords: ['pomodoro', 'break', 'settings', 'length', 'goal', 'rounds'],
    run: (c) => c.navigate('settings', { section: 'focus' }),
  },
]

/**
 * Settings (Phase 10B): the page with its section nav, and the Data tools (export, import, reset, the
 * weekly backup reminder). Other features add their own sections through `settings.sections`.
 * Phase 11 (Safety) contributes "Snapshots" the same way, under the id `safety.snapshots`.
 */
const manifest: FeatureManifest = {
  id: 'settings',
  routes: { settings: lazy(() => import('./SettingsPage')) },
  shortcuts,
  commands,
  slots: [
    { slot: 'settings.sections', id: 'settings.blocker', order: 40, component: BlockerSection },
    { slot: 'global.overlays', id: 'settings.host', order: 80, component: SettingsHost },
  ],
}

export default manifest
