import { useToday } from '@/app/hooks/useToday'
import { useSettings } from '@/db/hooks/useSettings'
import type { ISODate } from '@/db/types'
import type { WeekStart } from '@/logic/dates'

export interface ProgressEnv {
  today: ISODate
  weekStartsOn: WeekStart
}

/** The local day and the week start, or `undefined` while settings load (sections show their skeleton). */
export function useProgressEnv(): ProgressEnv | undefined {
  const today = useToday()
  const settings = useSettings()
  return settings ? { today, weekStartsOn: settings.weekStartsOn } : undefined
}
