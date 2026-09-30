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
  /**
   * One tag per session. Notifications with the same tag replace each other and, being replacements,
   * do not alert again, so a shared tag would silence the second session's notification.
   */
  tag?: string
  /** Click handler for the notification (e.g. focus the app and open the end dialog). */
  onClick?: () => void
}

/**
 * Plays the chime and shows the notification the settings ask for. The notification stays silent only
 * when the chime really sounded (the browser can keep it silent until a click), so there is one sound,
 * not two and not none. Never rejects.
 */
export async function alertSessionEnd(
  settings: SoundSettings,
  message: SessionEndMessage,
): Promise<void> {
  const plan = planSessionEndAlert(settings, notifyPermission())
  const chimed = plan.chimeVolume === null ? false : await playChime(plan.chimeVolume)
  if (!plan.notification) return
  await notify(message.title, message.body, {
    silent: chimed,
    ...(message.tag === undefined ? {} : { tag: message.tag }),
    onClick: message.onClick,
  })
}
