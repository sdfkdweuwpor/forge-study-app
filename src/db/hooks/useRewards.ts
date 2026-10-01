import { useLiveQuery } from 'dexie-react-hooks'
import { listRedemptions, listRewards } from '../repos/rewards'
import type { Redemption, Reward } from '../types'

/**
 * Live rewards in shop order, archived ones included (filter with `shopRewards` from `@/logic/rewards`).
 * `undefined` while loading. Write with the functions in `@/db/repos/rewards`.
 */
export function useRewards(): Reward[] | undefined {
  return useLiveQuery(listRewards)
}

/** Live redemptions, newest first, refunded ones included. `undefined` while loading. */
export function useRedemptions(): Redemption[] | undefined {
  return useLiveQuery(listRedemptions)
}
