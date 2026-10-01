import { useEffect, useState } from 'react'
import { dayOf, nextDayStartMs } from '@/logic/dates'
import type { ISODate } from '@/db/types'

/** The local calendar day, re-rendering at local midnight (and when the tab becomes visible again). */
export function useToday(): ISODate {
  const [today, setToday] = useState<ISODate>(() => dayOf(Date.now()))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const refresh = () => {
      setToday(dayOf(Date.now()))
    }
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

  return today
}
