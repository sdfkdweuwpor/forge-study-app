/**
 * Reads for the planner's goal-page pieces. This is the one file in the feature that imports the Dexie
 * instance. Hooks return `undefined` while their first query loads.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { pendingProposals } from '@/db/repos/proposals'
import type { Goal, ID, ISODate, PlanProposal } from '@/db/types'

/** The goal's pending plan proposals for `today`, newest first. */
export function usePendingProposals(goalId: ID, today: ISODate): PlanProposal[] | undefined {
  return useLiveQuery(() => pendingProposals(goalId, today), [goalId, today])
}

/** One goal; `null` when it does not exist. */
export function useGoal(goalId: ID): Goal | null | undefined {
  return useLiveQuery(async () => (await db.goals.get(goalId)) ?? null, [goalId])
}
