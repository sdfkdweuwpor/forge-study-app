import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useActiveSession } from '@/db/hooks/useActiveSession'
import { promptAction } from '@/logic/pwaUpdate'
import { useToast } from '@/ui/Toast'
import { updateStore } from './updateStore'

const TOAST_ID = 'pwa-update'

/**
 * "Update ready" toast with a Reload button, shown when a newer version is installed. It never reloads
 * anything by itself, and it stays away while a focus or break session is running (or paused): it
 * appears when the session ends, and a toast that is up when one starts is taken down. Slot
 * `global.overlays`.
 */
export function UpdatePrompt() {
  const toast = useToast()
  const phase = useSyncExternalStore(updateStore.subscribe, updateStore.getPhase, () => 'idle')
  const session = useActiveSession()
  const sessionActive = session === undefined ? undefined : session !== null
  const shown = useRef(false)

  useEffect(() => {
    const action = promptAction({
      updateReady: phase !== 'idle',
      sessionActive,
      shown: shown.current,
    })
    if (action === 'show') {
      shown.current = true
      toast.show({
        id: TOAST_ID,
        title: 'Update ready',
        description: 'A new version of Forge is installed.',
        duration: 0,
        action: {
          label: 'Reload',
          onClick: () => {
            shown.current = false
            void updateStore.apply()
          },
        },
      })
    } else if (action === 'hide') {
      shown.current = false
      toast.dismiss(TOAST_ID)
    }
  }, [phase, sessionActive, toast])

  return null
}
