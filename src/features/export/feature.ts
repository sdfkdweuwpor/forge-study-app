import { CalendarDays, FileDown, FileText } from 'lucide-react'
import { lazy } from 'react'
import type { CommandDef, FeatureManifest, ShortcutDef } from '@/app/registry'
import { requestExport } from './commandBus'
import { ExportCommandHost } from './ExportCommandHost'

const ExportSection = lazy(() =>
  import('./ExportSection').then((m) => ({ default: m.ExportSection })),
)

const shortcuts: ShortcutDef[] = [
  {
    id: 'export.csv',
    keys: 'o c',
    description: 'Export tasks as CSV',
    group: 'Data',
    scope: 'global',
    run: () => requestExport('csv'),
  },
  {
    id: 'export.markdown',
    keys: 'o m',
    description: 'Export tasks as Markdown',
    group: 'Data',
    scope: 'global',
    run: () => requestExport('markdown'),
  },
  {
    id: 'export.ics',
    keys: 'o i',
    description: 'Download calendar (.ics)',
    group: 'Data',
    scope: 'global',
    run: () => requestExport('ics'),
  },
]

const commands: CommandDef[] = [
  {
    id: 'command.export.csv',
    title: 'Export tasks as CSV',
    group: 'Data',
    icon: FileDown,
    shortcutId: 'export.csv',
    keywords: ['download', 'spreadsheet', 'excel', 'save'],
    run: () => requestExport('csv'),
  },
  {
    id: 'command.export.markdown',
    title: 'Export tasks as Markdown',
    group: 'Data',
    icon: FileText,
    shortcutId: 'export.markdown',
    keywords: ['download', 'notes', 'checklist', 'md', 'save'],
    run: () => requestExport('markdown'),
  },
  {
    id: 'command.export.ics',
    title: 'Download calendar (.ics)',
    group: 'Data',
    icon: CalendarDays,
    shortcutId: 'export.ics',
    keywords: ['export', 'google calendar', 'apple calendar', 'ical', 'schedule'],
    run: () => requestExport('ics'),
  },
]

/** Export (Phase 11): tasks as CSV or Markdown, the study calendar as .ics. Settings section plus palette commands. */
const manifest: FeatureManifest = {
  id: 'export',
  shortcuts,
  commands,
  slots: [
    { slot: 'settings.sections', id: 'export.section', order: 60, component: ExportSection },
    { slot: 'global.overlays', id: 'export.host', order: 90, component: ExportCommandHost },
  ],
}

export default manifest
