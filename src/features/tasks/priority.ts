import type { Priority } from '@/db/types'
import { priorityLabel } from '@/logic/taskQuery'

export const PRIORITIES: readonly Priority[] = [0, 1, 2, 3, 4]

/** "Low", "Medium"… for menus and screen readers. */
export { priorityLabel }

/** Shortcut key of a priority (`0`–`4`). */
export function priorityKey(priority: Priority): string {
  return String(priority)
}
