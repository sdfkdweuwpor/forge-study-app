import type { ISODate } from '@/db/types'

/** `forge-tasks-2026-09-30.csv`, `forge-calendar-2026-09-30.ics`. */
export function exportFilename(
  kind: 'tasks' | 'calendar',
  day: ISODate,
  ext: 'csv' | 'md' | 'ics',
): string {
  return `forge-${kind}-${day}.${ext}`
}
