import { useEffect } from 'react'
import { useToast } from '@/ui'
import {
  downloadCalendar,
  exportTasksCsv,
  exportTasksMarkdown,
  type ExportOutcome,
} from './actions'
import { EXPORT_EVENT, type ExportCommand } from './commandBus'

const RUN: Record<ExportCommand, () => Promise<ExportOutcome>> = {
  csv: () => exportTasksCsv(),
  markdown: () => exportTasksMarkdown(),
  ics: () => downloadCalendar(),
}

/** Renders nothing; runs exports requested from the palette or the keyboard and reports them in a toast. */
export function ExportCommandHost() {
  const toast = useToast()
  useEffect(() => {
    function onRequest(e: Event): void {
      const kind = (e as CustomEvent<ExportCommand>).detail
      const run = RUN[kind]
      if (!run) return
      void run().then((r) => (r.ok ? toast.success(r.message) : toast.error(r.message)))
    }
    window.addEventListener(EXPORT_EVENT, onRequest)
    return () => window.removeEventListener(EXPORT_EVENT, onRequest)
  }, [toast])
  return null
}
