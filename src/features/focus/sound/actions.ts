/**
 * What the sound controls do. Shared by the settings section, the Focus page control, the command
 * palette and the keyboard shortcut, so they all behave the same way.
 */
import { getSettings, updateSettings } from '@/db/repos/settings'
import type { AmbientSound } from '@/db/types'
import { isAmbientPlaying, startAmbient, stopAmbient } from '@/lib/audio'
import { requestNotifyPermission, type NotifyPermission } from '@/lib/notify'
import { runtime } from '../runtime'

/**
 * Picks the ambient bed used for focus sessions, and plays it right away (so the choice is heard)
 * or stops it for `none`. Must run from a click or key handler so the browser allows sound. At volume
 * 0, or with sounds off, the choice is saved and nothing is started: there would be nothing to hear.
 */
export async function chooseAmbient(kind: AmbientSound, volume: number): Promise<void> {
  await updateSettings({ sound: { ambient: kind } })
  if (kind === 'none') {
    await stopAmbient()
    return
  }
  const { sound } = await getSettings()
  if (sound.enabled && volume > 0) await startAmbient(kind, volume)
}

/**
 * Stops a bed that was only being tried out, when its control goes away. A focus session that is
 * running owns its bed, so that one keeps playing when the person leaves the Focus page.
 */
export function stopPreview(): void {
  const timer = runtime()?.snapshot()
  const focusing = timer?.session?.kind === 'focus' && timer.status === 'running'
  if (!focusing && isAmbientPlaying()) void stopAmbient(300)
}

/** Plays or pauses ambient sound. With no bed chosen yet it plays brown noise. Does nothing while sounds are off or the volume is 0. */
export async function toggleAmbient(): Promise<void> {
  if (isAmbientPlaying()) {
    await stopAmbient()
    return
  }
  const { sound } = await getSettings()
  if (!sound.enabled || sound.ambientVolume <= 0) return
  await startAmbient(sound.ambient === 'none' ? 'brown' : sound.ambient, sound.ambientVolume)
}

/** Turns all sound on or off. Turning it off also stops any ambient bed. */
export async function setSoundsEnabled(enabled: boolean): Promise<void> {
  await updateSettings({ sound: { enabled } })
  if (!enabled) await stopAmbient()
}

/** Flips the master sound switch. */
export async function toggleSounds(): Promise<void> {
  const { sound } = await getSettings()
  await setSoundsEnabled(!sound.enabled)
}

/**
 * Asks the browser for notification permission and records the outcome, so we ask once and the
 * notify setting matches what the browser allowed. Call from a click handler.
 */
export async function allowNotifications(): Promise<NotifyPermission> {
  const permission = await requestNotifyPermission()
  await updateSettings({
    notifications: { enabled: permission === 'granted', promptedAt: Date.now() },
  })
  return permission
}

/** Records that the prompt was answered "not now", so it is never shown again. */
export async function dismissNotifyPrompt(): Promise<void> {
  await updateSettings({ notifications: { promptedAt: Date.now() } })
}
