import { useEffect } from 'react'
import { unlockMessages } from '@/logic/badges'
import { useToast } from '@/ui/Toast'
import { onBadgesUnlocked } from './badgeHandlers'

/**
 * Slot `global.overlays`: a gentle gold toast when a badge is earned, "Badge unlocked · Early Bird 🌅".
 * It listens for what the reconcile just inserted, so it shows in the tab that did the work, and never
 * for the first credit of old history. It renders nothing itself.
 */
export function BadgeUnlockToaster() {
  const toast = useToast()
  useEffect(
    () =>
      onBadgesUnlocked((badges) => {
        for (const m of unlockMessages(badges.map((b) => b.id))) {
          toast.xp(m.title, { id: m.key, description: m.description })
        }
      }),
    [toast],
  )
  return null
}
