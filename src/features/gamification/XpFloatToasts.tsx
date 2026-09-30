import { useEffect } from 'react'
import { celebrate } from '@/app/celebrate'
import { onDomainEvent } from '@/db/events'
import { dayOf } from '@/logic/dates'
import { formatXp } from '@/logic/taskDisplay'

/**
 * Slot `global.overlays`: says so when the daily goal pays out, in gold: "Daily goal hit · +25 XP". It
 * listens for the award itself (`xp.changed` with source `dailyGoal`), so it shows in the tab that did
 * the writing and only for today: a start-up reconcile that pays yesterday's goal is not news, but one
 * that pays today's (the goal was reached while the app was closed) is. The toast goes through the
 * celebration queue, so it waits for the level-up moment it may have caused and never for a mount order.
 */
export function DailyGoalToast() {
  useEffect(
    () =>
      onDomainEvent('xp.changed', (e) => {
        if (e.source !== 'dailyGoal' || e.amount <= 0) return
        if (e.day !== dayOf(Date.now())) return
        celebrate({ id: `dailyGoal:${e.day}`, title: `Daily goal hit · ${formatXp(e.amount)}` })
      }),
    [],
  )
  return null
}
