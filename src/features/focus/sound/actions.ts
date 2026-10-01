/**
 * What the sound controls do. Shared by the settings section, the command palette and the notification
 * prompt, so they all behave the same way.
 */
import { getSettings, updateSettings } from '@/db/repos/settings'
import { requestNotifyPermission, type NotifyPermission } from '@/lib/notify'

/** Turns all sound on or off. Turning it off silences the mix too (SoundHost stops it). */
export async function setSoundsEnabled(enabled: boolean): Promise<void> {
  await updateSettings({ sound: { enabled } })
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
