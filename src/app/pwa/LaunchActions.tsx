import { useEffect } from 'react'
import { useOverlays } from '../providers/OverlayProvider'
import { setQuery, useQuery } from '../router'

/**
 * Handles the installed app's "Quick add" shortcut (manifest shortcut `/?quickadd=1`): opens quick add,
 * then drops the parameter so a reload does not open it again. Slot `global.overlays`.
 */
export function LaunchActions() {
  const wantsQuickAdd = useQuery().quickadd === '1'
  const overlays = useOverlays()
  useEffect(() => {
    if (!wantsQuickAdd) return
    overlays.open('quickAdd')
    setQuery({ quickadd: undefined })
  }, [wantsQuickAdd, overlays])
  return null
}
