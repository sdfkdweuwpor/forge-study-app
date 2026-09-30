import { ArchiveRestore, Camera, Trash2 } from 'lucide-react'
import { lazy } from 'react'
import type { CommandDef, FeatureManifest } from '@/app/registry'
import { scheduleSafetyChores } from './chores'
import { requestSnapshotNow } from './commandBus'
import { safetyShortcuts } from './shortcuts'

// The page, the Settings section and the host are not needed for the first paint.
const TrashPage = lazy(() => import('./TrashPage'))
const SnapshotsSection = lazy(() =>
  import('./SnapshotsSection').then((m) => ({ default: m.SnapshotsSection })),
)
const SafetyHost = lazy(() => import('./SafetyHost').then((m) => ({ default: m.SafetyHost })))

const commands: CommandDef[] = [
  {
    id: 'command.trash.open',
    title: 'Open Trash',
    group: 'Data',
    icon: Trash2,
    shortcutId: 'trash.open',
    keywords: ['deleted', 'restore', 'bin', 'recover', 'undelete'],
    run: (c) => c.navigate('trash'),
  },
  {
    id: 'command.trash.empty',
    title: 'Empty Trash…',
    group: 'Data',
    icon: Trash2,
    keywords: ['delete forever', 'permanently', 'purge', 'clear'],
    // Opens the confirmation; nothing is deleted until the words are typed.
    run: (c) => c.navigate('trash', undefined, { query: { do: 'empty' } }),
  },
  {
    id: 'command.snapshot.now',
    title: 'Take a snapshot now',
    group: 'Data',
    icon: Camera,
    shortcutId: 'snapshot.now',
    keywords: ['backup', 'save', 'copy', 'checkpoint'],
    run: () => requestSnapshotNow(),
  },
  {
    id: 'command.snapshot.restore',
    title: 'Restore from a snapshot…',
    group: 'Data',
    icon: ArchiveRestore,
    keywords: ['snapshot', 'roll back', 'undo', 'recover', 'backup'],
    run: (c) => c.navigate('settings', { section: 'snapshots' }),
  },
]

/**
 * The safety net (Phase 11c): the Trash page, the daily snapshot and its Settings section. At app start,
 * once the browser is idle, it removes Trash items older than 30 days and writes the automatic snapshot
 * (see `chores.ts`).
 */
const manifest: FeatureManifest = {
  id: 'safety',
  routes: { trash: TrashPage },
  shortcuts: safetyShortcuts,
  commands,
  slots: [
    { slot: 'settings.sections', id: 'safety.snapshots', order: 70, component: SnapshotsSection },
    { slot: 'global.overlays', id: 'safety.host', order: 85, component: SafetyHost },
  ],
  onAppStart: async ({ now, today }) => {
    // Scheduled, not awaited: the app's start-up runs every feature's hook one after the other.
    scheduleSafetyChores({ now, today })
  },
}

export default manifest
