import { addDays, startOfWeekISO, type WeekStart } from '@/logic/dates'

/** `'YYYY-MM-DD'`, a local calendar day (the ui layer may not import `@/db/types`). */
type ISODate = string

export type QuickDateId = 'today' | 'tomorrow' | 'next-week'

export interface QuickDate {
  id: QuickDateId
  label: string
  date: ISODate
}

const LABELS: Record<QuickDateId, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  'next-week': 'Next week',
}

/**
 * Quick-pick dates relative to `today`. "Next week" is the first day of the next week, so it
 * follows the user's week-start setting (Monday by default, Sunday for `weekStartsOn: 0`).
 * `today` is passed in, never read from the clock, so the result is testable.
 */
export function quickDates(
  today: ISODate,
  ids: readonly QuickDateId[] = ['today', 'tomorrow', 'next-week'],
  weekStartsOn: WeekStart = 1,
): QuickDate[] {
  const dateFor = (id: QuickDateId): ISODate => {
    switch (id) {
      case 'today':
        return today
      case 'tomorrow':
        return addDays(today, 1)
      case 'next-week':
        return addDays(startOfWeekISO(today, weekStartsOn), 7)
    }
  }
  return ids.map((id) => ({ id, label: LABELS[id], date: dateFor(id) }))
}
