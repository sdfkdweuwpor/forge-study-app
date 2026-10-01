import { useEffect, useState } from 'react'
import { dayOf, nextDayStartMs } from '@/logic/dates'
import type { ISODate } from '../types'
import { useXpSummary, type XpSummary } from './useXpSummary'

export type { XpSummary } from './useXpSummary'

/** The local calendar day, moving on at local midnight (so "XP today" starts again on time). */
function useLocalDay(): ISODate {
  const [day, setDay] = useState<ISODate>(() => dayOf(Date.now()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => setDay(dayOf(Date.now()))
    const arm = () => {
      const now = Date.now()
      // Never sleep past a day boundary; re-arm often enough to survive clock changes and laptop sleep.
      const delay = Math.min(Math.max(1_000, nextDayStartMs(now) - now + 50), 60 * 60 * 1000)
      timer = setTimeout(() => {
        refresh()
        arm()
      }, delay)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    arm()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return day
}

/**
 * Everything the level meter and the shop need, live: `lifetime` XP (what levels use), `spent`,
 * `balance` (lifetime − spent), `today` (XP attributed to today, reversals netted) and `level`
 * (`{ level, intoLevel, needed, progress }`). Derived from the append-only log on every change, so it
 * cannot drift. `undefined` only while the first query is loading.
 */
export function useXp(): XpSummary | undefined {
  return useXpSummary(useLocalDay())
}
