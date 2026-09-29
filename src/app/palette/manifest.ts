import { Command, Keyboard } from 'lucide-react'
import type { CommandCtx, FeatureManifest } from '../registry/types'
import { requestPaletteMode } from './paletteMode'
import type { PaletteMode } from './paletteModel'

/**
 * The palette and shortcut sheet register like any feature, so they show up in each other: the
 * palette lists "Keyboard shortcuts", and the sheet lists `mod+k`. Overlay UI is mounted by App.
 */

/** Opens the palette on top of nothing: the other overlays would sit behind its native dialog. */
function openPalette(c: CommandCtx, mode: PaletteMode): void {
  c.overlays.close('quickAdd')
  c.overlays.close('shortcuts')
  requestPaletteMode(mode)
  c.overlays.open('palette')
}

export const paletteManifest: FeatureManifest = {
  id: 'palette',
  shortcuts: [
    {
      id: 'palette.open',
      keys: 'mod+k',
      description: 'Open the command palette',
      group: 'General',
      scope: 'global',
      allowInInputs: true,
      run: (c) => {
        if (c.overlays.isOpen('palette')) c.overlays.close('palette')
        else openPalette(c, 'all')
      },
    },
    {
      id: 'palette.search',
      keys: '/',
      description: 'Search tasks, goals and pages',
      group: 'General',
      scope: 'global',
      run: (c) => openPalette(c, 'search'),
    },
    {
      id: 'shortcuts.open',
      keys: '?',
      description: 'Show keyboard shortcuts',
      group: 'General',
      scope: 'global',
      run: (c) => {
        if (c.overlays.isOpen('shortcuts')) c.overlays.close('shortcuts')
        else {
          c.overlays.close('quickAdd')
          c.overlays.open('shortcuts')
        }
      },
    },
  ],
  commands: [
    {
      id: 'command.palette',
      title: 'Open command palette',
      group: 'Help',
      icon: Command,
      keywords: ['search', 'find', 'actions'],
      shortcutId: 'palette.open',
      // Already open when it is shown in the palette itself, so it is only offered elsewhere.
      when: (c) => !c.overlays.isOpen('palette'),
      run: (c) => openPalette(c, 'all'),
    },
    {
      id: 'command.shortcuts',
      title: 'Keyboard shortcuts',
      group: 'Help',
      icon: Keyboard,
      keywords: ['keys', 'hotkeys', 'help', 'cheatsheet'],
      shortcutId: 'shortcuts.open',
      run: (c) => c.overlays.open('shortcuts'),
    },
  ],
}
