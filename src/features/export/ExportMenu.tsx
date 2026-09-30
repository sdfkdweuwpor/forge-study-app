import { Download } from 'lucide-react'
import { Dropdown, IconButton, useToast } from '@/ui'
import {
  copyTasksMarkdown,
  downloadCalendar,
  exportTasksCsv,
  exportTasksMarkdown,
  type ExportOutcome,
} from './actions'

/** A small "Export" menu for a tasks toolbar: CSV, Markdown, copy as Markdown, calendar. Exports every task. */
export function ExportMenu() {
  const toast = useToast()
  const report = (p: Promise<ExportOutcome>): void => {
    void p.then((r) => (r.ok ? toast.success(r.message) : toast.error(r.message)))
  }
  return (
    <Dropdown
      label="Export"
      trigger={(p) => <IconButton {...p} label="Export" icon={<Download />} />}
      items={[
        { id: 'csv', label: 'Tasks as CSV', onSelect: () => report(exportTasksCsv()) },
        { id: 'md', label: 'Tasks as Markdown', onSelect: () => report(exportTasksMarkdown()) },
        {
          id: 'copy',
          label: 'Copy tasks as Markdown',
          onSelect: () => report(copyTasksMarkdown()),
        },
        { id: 'ics', label: 'Calendar (.ics)', onSelect: () => report(downloadCalendar()) },
      ]}
    />
  )
}
