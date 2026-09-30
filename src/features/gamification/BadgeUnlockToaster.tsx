import { useEffect } from 'react'
import { celebrate } from '@/app/celebrate'
import { unlockMessages } from '@/logic/badges'
import { onBadgesUnlocked } from './badgeHandlers'

/** `badge:streak-7` is the badge that goes with the 7-day streak milestone (7, 30 and 100). */
const STREAK_BADGE = /^badge:streak-(\d+)$/

/**
 * Slot `global.overlays`: a gentle gold toast when a badge is earned, "Badge unlocked · Early Bird 🌅".
 * It listens for what the reconcile just inserted, so it shows in the tab that did the work, and never
 * for the first credit of old history. It renders nothing itself.
 *
 * A streak badge arrives together with its milestone's XP ("7-day streak · +100 XP 🔥"), so it shares the
 * milestone's merge key: the queue shows them as one toast, "7-day streak · +100 XP 🔥 · Badge unlocked".
 */
export function BadgeUnlockToaster() {
  useEffect(
    () =>
      onBadgesUnlocked((badges) => {
        for (const m of unlockMessages(badges.map((b) => b.id))) {
          const days = STREAK_BADGE.exec(m.key)?.[1]
          celebrate({
            id: m.key,
            title: m.title,
            description: m.description,
            order: 1,
            ...(days === undefined ? {} : { mergeKey: `streak:${days}`, joinAs: 'Badge unlocked' }),
          })
        }
      }),
    [],
  )
  return null
}
