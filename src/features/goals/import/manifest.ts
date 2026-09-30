/**
 * The plan import's contribution to the goals manifest (slots, commands, shortcuts). It is kept apart from
 * `index.ts`, which also re-exports the import's components: the manifest is in the first download, the
 * components are only for the goals pages, and a barrel would bring them along.
 */
import { lazy } from 'react'
import type { FeatureManifest, SlotContribution } from '@/app/registry'
import { importCommands } from './commands'
import { importShortcuts } from './shortcuts'

// Only the goal page draws the panel, so it is its own chunk.
const ImportPanelSlot = lazy(() =>
  import('./ImportPanel').then((m) => ({ default: m.ImportPanel })),
)

export const importSlots: SlotContribution[] = [
  { slot: 'goal.panels', id: 'goals.import', order: 90, component: ImportPanelSlot },
]

/** The manifest plus the import's slots, commands and shortcuts (the manifest's own are kept). */
export function withPlanImport(manifest: FeatureManifest): FeatureManifest {
  return {
    ...manifest,
    slots: [...(manifest.slots ?? []), ...importSlots],
    commands: [...(manifest.commands ?? []), ...importCommands],
    shortcuts: [...(manifest.shortcuts ?? []), ...importShortcuts],
  }
}
