/**
 * Reads for the weekly review page and the Sunday prompt: the numbers of a week (`loadReviewInput`, one
 * read-only snapshot) and the stored row (the person's note and whether the review is done). Both are
 * live queries, so a session that ends or a task that is checked off while the page is open shows up.
 * A hook is `undefined` only while its first read is loading; a failed read throws to the nearest error
 * boundary, like every live query.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { getWeeklyReview, loadReviewInput } from '@/db/repos/reviews'
import type { ISODate, WeeklyReview as ReviewRow } from '@/db/types'
import { buildWeeklyReview, type WeeklyReview } from '@/logic/weeklyReview'

/** The finished review of a week (numbers and wins), rebuilt whenever the data under it changes. */
export function useWeeklyReview(weekStart: ISODate, today: ISODate): WeeklyReview | undefined {
  const input = useLiveQuery(() => loadReviewInput(weekStart, today), [weekStart, today])
  return useMemo(() => (input ? buildWeeklyReview(input) : undefined), [input])
}

/**
 * The stored row of a week: `null` when nothing was saved for it yet (or `weekStart` is `null`, while
 * the week start setting is still loading), `undefined` while loading.
 */
export function useStoredReview(weekStart: ISODate | null): ReviewRow | null | undefined {
  return useLiveQuery(
    async () => (weekStart === null ? null : ((await getWeeklyReview(weekStart)) ?? null)),
    [weekStart],
  )
}
