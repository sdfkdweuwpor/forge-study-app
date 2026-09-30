import { useCallback, useState } from 'react'
import { useToast } from '@/ui/Toast'
import { exportBackupFile } from './backupActions'

/** Runs an export and reports it in a toast (used by the Data section, the palette, the shortcut and the reminder). */
export function useBackupExport(): { busy: boolean; run: () => Promise<boolean> } {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = useCallback(async () => {
    setBusy(true)
    const outcome = await exportBackupFile()
    setBusy(false)
    if (outcome.ok) toast.success('Backup saved', { description: outcome.message })
    else toast.error('Export failed', { description: outcome.message })
    return outcome.ok
  }, [toast])
  return { busy, run }
}
