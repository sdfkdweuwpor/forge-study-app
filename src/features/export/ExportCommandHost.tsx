import { useEffect } from 'react'
import { useToast } from '@/ui'
import type { ExportOutcome } from './actions'
import { EXPORT_EVENT, type ExportCommand } from './commandBus'

// The exporters (repositories, CSV, Markdown, .ics) load when the first export is asked for.
const RUN: Record<ExportCommand, () => Promise<ExportOutcome>> = {
  csv: async () => (await import('./actions')).exportTasksCsv(),
  markdown: async () => (await import('./actions')).exportTasksMarkdown(),
  ics: async () => (await import('./actions')).downloadCalendar(),
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
