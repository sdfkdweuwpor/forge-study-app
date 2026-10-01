import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useSettings } from '@/db/hooks/useSettings'
import type { Settings, SoundMixer } from '@/db/types'
import { effectiveMixer } from '@/logic/soundMix'
import { getOverlay, subscribeOverlay, pruneOverlay, withOverlay } from './mixActions'
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
  // Overlay entries stay until the stored row shows them, so the mix never reads an old value in between.
  useEffect(() => {
    if (stored) pruneOverlay(stored)
  }, [stored])
  return useMemo(() => stored && withOverlay(stored, overlay), [stored, overlay])
}

export interface SoundDevice {
  playing: boolean
  open: { lofi: boolean; sounds: boolean; mixes: boolean }
}

/** This device's play switch and which panel sections are open. `undefined` while loading. */
export function useSoundDevice(): SoundDevice | undefined {
  const settings = useSettings()
  const device = settings?.sound.device
  return useMemo(
    () =>
      settings && {
        playing: device?.playing ?? false,
        open: {
          lofi: device?.open?.lofi ?? false,
          sounds: device?.open?.sounds ?? false,
          mixes: device?.open?.mixes ?? false,
        },
      },
    [settings, device],
  )
}

/** The browser's notification permission, kept current (it can change in site settings at any time). */
export function useNotifyPermission(): NotifyPermission {
  return useSyncExternalStore(subscribeNotifyPermission, notifyPermission, () => 'unsupported')
}
