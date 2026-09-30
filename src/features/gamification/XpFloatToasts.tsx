import { useEffect } from 'react'
import { onDomainEvent } from '@/db/events'
import { dayOf } from '@/logic/dates'
import { formatXp } from '@/logic/taskDisplay'
import { useToast } from '@/ui/Toast'

/**
 * Slot `global.overlays`: says so when the daily goal pays out, in gold: "Daily goal hit · +25 XP". It
 * listens for the award itself (`xp.changed` with source `dailyGoal`), so it shows in the tab that did
 * the writing and only for today: a start-up reconcile that pays yesterday's goal is not news.
 */
export function DailyGoalToast() {
  const toast = useToast()
  useEffect(
    () =>
      onDomainEvent('xp.changed', (e) => {
        if (e.source !== 'dailyGoal' || e.amount <= 0) return
        if (e.day !== dayOf(Date.now())) return
        toast.xp(`Daily goal hit · ${formatXp(e.amount)}`, { id: `dailyGoal:${e.day}` })
      }),
    [toast],
  )
  return null
}
