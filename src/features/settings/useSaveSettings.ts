import { useCallback, useState } from 'react'
import { recordError } from '@/app/reportError'
import { updateSettings, type SettingsPatch } from '@/db/repos/settings'

export interface SaveStatus {
  tone: 'saved' | 'error'
  text: string
}

/**
 * Saves a settings patch and keeps the one line a section shows under its rows ("Saved." or what went
 * wrong). Never throws: a failed write is reported in the section and in the error log.
 */
export function useSaveSettings(): {
  save: (patch: SettingsPatch) => Promise<boolean>
  status: SaveStatus | null
} {
  const [status, setStatus] = useState<SaveStatus | null>(null)
  const save = useCallback(async (patch: SettingsPatch) => {
    try {
      await updateSettings(patch)
      setStatus({ tone: 'saved', text: 'Saved.' })
      return true
    } catch (e) {
      recordError(e, 'settings.save')
      setStatus({ tone: 'error', text: 'Couldn’t save that. Try again.' })
      return false
    }
  }, [])
  return { save, status }
}
