import { useMemo, useSyncExternalStore } from 'react'
import { useSettings } from '@/db/hooks/useSettings'
import type { Settings } from '@/db/types'
import { ambientKind, subscribeAudio, type AmbientKind } from '@/lib/audio'
import { notifyPermission, subscribeNotifyPermission, type NotifyPermission } from '@/lib/notify'

/** The slice of settings that decides what makes noise or pings. */
export interface SoundSettings {
  sound: Settings['sound']
  notifications: Settings['notifications']
}

/** Live sound and notification settings. `undefined` only while the first read is loading. */
export function useSoundSettings(): SoundSettings | undefined {
  const settings = useSettings()
  return useMemo(
    () => (settings ? { sound: settings.sound, notifications: settings.notifications } : undefined),
    [settings],
  )
}

/** The ambient bed that is playing right now, or `null`. Updates as it starts and stops. */
export function useAmbientKind(): AmbientKind | null {
  return useSyncExternalStore(subscribeAudio, ambientKind, () => null)
}

/** The browser's notification permission, kept current (it can change in site settings at any time). */
export function useNotifyPermission(): NotifyPermission {
  return useSyncExternalStore(subscribeNotifyPermission, notifyPermission, () => 'unsupported')
}
