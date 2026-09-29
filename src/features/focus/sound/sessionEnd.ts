/**
 * The alerts for the end of a focus session: the chime and the browser notification, each only when
 * the settings and the browser allow it. 4A calls `alertSessionEnd` once when a session finishes.
 */
import { playChime } from '@/lib/audio'
import { notify, notifyPermission, type NotifyPermission } from '@/lib/notify'
import type { SoundSettings } from './hooks'

export interface SessionEndPlan {
  /** Volume to chime at, or `null` for no chime. */
  chimeVolume: number | null
  notification: boolean
}

/** Decides what to do at the end of a session. Pure, so the rules are testable. */
export function planSessionEndAlert(
  settings: SoundSettings,
  permission: NotifyPermission,
): SessionEndPlan {
  const { sound, notifications } = settings
  const chime = sound.enabled && sound.chime && sound.volume > 0
  return {
    chimeVolume: chime ? sound.volume : null,
    notification: notifications.enabled && permission === 'granted',
  }
}

export interface SessionEndMessage {
  title: string
  body: string
  /** Click handler for the notification (e.g. focus the app and open the end dialog). */
  onClick?: () => void
}

/**
 * Plays the chime and shows the notification the settings ask for. The notification stays silent
 * when the chime plays, so there is one sound, not two. Never rejects.
 */
export async function alertSessionEnd(
  settings: SoundSettings,
  message: SessionEndMessage,
): Promise<void> {
  const plan = planSessionEndAlert(settings, notifyPermission())
  await Promise.all([
    plan.chimeVolume === null ? undefined : playChime(plan.chimeVolume),
    plan.notification
      ? notify(message.title, message.body, {
          silent: plan.chimeVolume !== null,
          onClick: message.onClick,
        })
      : undefined,
  ])
}
