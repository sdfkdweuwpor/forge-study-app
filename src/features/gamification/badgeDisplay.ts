import type { HHmm } from '@/db/types'
import { formatTimeOfDay } from '@/logic/taskDisplay'

/**
 * A stored badge context with its wall-clock times in the app's 12-hour style: "Started at 07:30" →
 * "Started at 7:30 AM", like every other time in Forge. Contexts are saved with the badge, so rows
 * written before this are fixed on the way out rather than migrated.
 */
export function displayContext(context: string): string {
  return context.replace(/\b([01]\d|2[0-3]):([0-5]\d)\b/g, (time) =>
    formatTimeOfDay(time as HHmm),
  )
}
