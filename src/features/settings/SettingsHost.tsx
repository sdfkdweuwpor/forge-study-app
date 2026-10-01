import { useEffect } from 'react'
import { recordError } from '@/app/reportError'
import { isBackupReminderDue, markReminded } from '@/db/repos/backup'
import { useToast } from '@/ui/Toast'
import { listenForBackupExport } from './commandBus'
import { takeImportNotice } from './importResult'
import { useBackupExport } from './useBackupExport'

/** Set once per page load: the reminder is checked at app start, never again while the app stays open. */
let reminderChecked = false

/**
 * Renders nothing (slot `global.overlays`). It runs the export asked for by the palette or `o b`, tells
 * someone whose import just reloaded the app what came in, and, once at app start, shows the weekly
 * "back up now?" note when it is due. The note is a plain toast: it goes away by itself, can be closed,
 * shows at most once a week and is switched off in Settings, Data.
 */
export function SettingsHost() {
  const toast = useToast()
  const exporter = useBackupExport()
  const runExport = exporter.run

  useEffect(() => listenForBackupExport(() => void runExport()), [runExport])

  useEffect(() => {
    const notice = takeImportNotice()
    if (!notice) return
    toast.success(`Imported · ${notice.items.toLocaleString('en-US')} items`, {
      description:
        notice.skippedFiles > 0
          ? `${notice.skippedFiles} attached ${notice.skippedFiles === 1 ? 'file was' : 'files were'} not in the backup and couldn’t be restored.`
          : undefined,
    })
  }, [toast])

  useEffect(() => {
    if (reminderChecked) return
    reminderChecked = true
    const now = Date.now()
    isBackupReminderDue(now)
      .then(async (due) => {
        if (!due) return
        // Recorded first: whatever happens to the toast, it is not shown again for a week.
        await markReminded(now)
        toast.show({
          title: 'It’s been a week since your last backup.',
          description: 'Export now? You can turn this reminder off in Settings.',
          duration: 15_000,
          action: { label: 'Export now', onClick: () => void runExport() },
        })
      })
      .catch((e: unknown) => recordError(e, 'backupReminder'))
  }, [toast, runExport])

  return null
}
