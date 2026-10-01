import { useMemo, useSyncExternalStore } from 'react'
import { useSettings } from '@/db/hooks/useSettings'
import type { Settings, SoundMixer } from '@/db/types'
import { ambientKind, subscribeAudio, type AmbientKind } from '@/lib/audio'
import { effectiveMixer } from '@/logic/soundMix'
import { getOverlay, subscribeOverlay, withOverlay } from './mixActions'
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

/** The mixer as sound should play it: stored values with unsaved slider moves on top. `undefined` while loading. */
export function useMixer(): SoundMixer | undefined {
  const settings = useSettings()
  const overlay = useSyncExternalStore(subscribeOverlay, getOverlay, getOverlay)
  const stored = useMemo(() => settings && effectiveMixer(settings.sound), [settings])
  return useMemo(() => stored && withOverlay(stored, overlay), [stored, overlay])
}

export interface SoundDevice {
  playing: boolean
  open: { lofi: boolean; sounds: boolean; mixes: boolean }
}

/** This device's play switch and which panel sections are open. */
export function useSoundDevice(): SoundDevice | undefined {
  const device = useSettings()?.sound.device
  const loaded = useSettings() !== undefined
  return useMemo(
    () =>
      loaded
        ? {
            playing: device?.playing ?? false,
            open: {
              lofi: device?.open?.lofi ?? false,
              sounds: device?.open?.sounds ?? false,
              mixes: device?.open?.mixes ?? false,
            },
          }
        : undefined,
    [loaded, device],
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
