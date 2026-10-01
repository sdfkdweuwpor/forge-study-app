import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { valueSharer } from '@/logic/share'
import { getXpSummary, type XpSummary } from '../repos/xp'
import type { ISODate } from '../types'

export type { XpSummary } from '../repos/xp'

/**
 * Live XP totals: lifetime, balance (lifetime minus what was spent), today's XP and the level. Derived
 * from the append-only log on every change, so it can never drift. `undefined` while loading.
 */
export function useXpSummary(today: ISODate): XpSummary | undefined {
  const [share] = useState(valueSharer<XpSummary>)
  return useLiveQuery(async () => share(await getXpSummary(today)), [today, share])
}
