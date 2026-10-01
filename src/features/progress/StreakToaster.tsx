import { useEffect } from 'react'
import { celebrate } from '@/app/celebrate'
import { onStreakMilestones } from './handlers'

/**
 * Slot `global.overlays`: a gold toast when a streak reaches 7, 30 or 100 days and its XP is paid,
 * "7-day streak · +100 XP 🔥". One warm line about the days and the reward, never about what could be
 * lost. It listens for what a live session just paid, so it shows in the tab that did the work and never
 * for history credited at app start. It renders nothing itself.
 *
 * The milestone's badge ("Badge unlocked · 7-Day Streak") shares the merge key `streak:<days>`, so the
 * celebration queue shows the two as one toast: "7-day streak · +100 XP 🔥 · Badge unlocked".
 */
export function StreakToaster() {
  useEffect(
    () =>
      onStreakMilestones((awards) => {
        for (const a of awards) {
          celebrate({
            id: a.milestone.key,
            title: `${a.milestone.days}-day streak · +${a.xp.toLocaleString('en-US')} XP 🔥`,
            mergeKey: `streak:${a.milestone.days}`,
            order: 0,
          })
        }
      }),
    [],
  )
  return null
}
