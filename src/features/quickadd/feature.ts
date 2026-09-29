import { Plus } from 'lucide-react'
import type { CommandCtx, FeatureManifest } from '@/app/registry'
import { QuickAddOverlay } from './QuickAddOverlay'

/** The palette's native dialog and the shortcut sheet sit above quick add, so they close first. */
function openQuickAdd(c: CommandCtx): void {
  c.overlays.close('palette')
  c.overlays.close('shortcuts')
  c.overlays.open('quickAdd')
}

const manifest: FeatureManifest = {
  id: 'quickadd',
  commands: [
    {
      id: 'command.newTask',
      title: 'New task',
      group: 'Create',
      icon: Plus,
      keywords: ['add', 'quick', 'create', 'todo'],
      shortcutId: 'quickadd.open',
      run: openQuickAdd,
    },
  ],
  shortcuts: [
    {
      id: 'quickadd.open',
      keys: 'q',
      description: 'Quick add a task',
      group: 'Tasks',
      scope: 'global',
      run: openQuickAdd,
    },
    {
      id: 'quickadd.openMod',
      keys: 'mod+enter',
      description: 'Quick add from anywhere',
      group: 'Tasks',
      scope: 'global',
      allowInInputs: true,
      run: openQuickAdd,
    },
  ],
  slots: [{ slot: 'global.overlays', id: 'quickadd.overlay', order: 10, component: QuickAddOverlay }],
}

export default manifest
