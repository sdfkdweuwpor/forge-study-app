import { useEffect } from 'react'
import { useToast } from '@/ui/Toast'
import { onStreakMilestones } from './handlers'

/**
 * Slot `global.overlays`: a gold toast when a streak reaches 7, 30 or 100 days and its XP is paid,
 * "7-day streak · +100 XP 🔥". One warm line about the days and the reward, never about what could be
 * lost. It listens for what a live session just paid, so it shows in the tab that did the work and never
 * for history credited at app start. It renders nothing itself.
 */
export function StreakToaster() {
  const toast = useToast()
  useEffect(
    () =>
      onStreakMilestones((awards) => {
        for (const a of awards) {
          toast.xp(`${a.milestone.days}-day streak · +${a.xp.toLocaleString('en-US')} XP 🔥`, {
            id: a.milestone.key,
          })
        }
      }),
    [toast],
  )
  return null
}
