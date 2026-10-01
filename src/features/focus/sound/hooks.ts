import { useMemo, useSyncExternalStore } from 'react'
import { useSettings } from '@/db/hooks/useSettings'
import type { Settings, SoundMixer } from '@/db/types'
import { effectiveMixer } from '@/logic/soundMix'
import { useTimer } from '../useTimer'
import { getOverlay, subscribeOverlay, wantsSound, withOverlay } from './mixActions'
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
  // This view's own row time decides which overlay entries it still needs (see `withOverlay`).
  return useMemo(
    () => stored && withOverlay(stored, overlay, settings?.updatedAt),
    [stored, overlay, settings?.updatedAt],
  )
}

export interface SoundDevice {
  playing: boolean
  open: { lofi: boolean; sounds: boolean; mixes: boolean }
  pausedSession: string | null
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
          sounds: device?.open?.sounds ?? true,
          mixes: device?.open?.mixes ?? false,
        },
        pausedSession: device?.pausedSession ?? null,
      },
    [settings, device],
  )
}

/** The browser's notification permission, kept current (it can change in site settings at any time). */
export function useNotifyPermission(): NotifyPermission {
  return useSyncExternalStore(subscribeNotifyPermission, notifyPermission, () => 'unsupported')
}

/** Whether this browser has Web Audio at all. A direct check, so no audio code loads just to ask. */
export function audioAvailable(): boolean {
  const w = window as { AudioContext?: unknown; webkitAudioContext?: unknown }
  return w.AudioContext !== undefined || w.webkitAudioContext !== undefined
}

/**
 * Whether this device should be making sound right now (the sounds switch, the mix, Play or a focus
 * session). SoundHost plays it; every Play/Pause control shows it.
 */
export function useWantsSound(): boolean {
  const enabled = useSettings()?.sound.enabled ?? false
  const mix = useMixer()
  const device = useSoundDevice()
  const { session } = useTimer()
  return wantsSound(enabled, mix, device?.playing ?? false, session, device?.pausedSession)
}
