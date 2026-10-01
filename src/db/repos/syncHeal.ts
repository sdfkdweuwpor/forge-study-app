/**
 * Healing after a sync pull (PLAN §4.7.5): two devices that both re-planned a goal offline each made their
 * own task for the same plan item, so after the merge the goal has two open tasks with one `scheduleKey`.
 * The goal is re-planned once (`rebalanceGoal`, reason `sync`): `diffPlanTasks` keeps the older task
 * (`byAge`, then id) and removes the other, the same one on every device, and the removal travels back as
 * a tombstone. Nothing else re-plans on a pull, so two devices cannot keep re-planning each other's
 * results with different clocks.
 *
 * The goals feature runs this from its `sync.applied` handler, lazily: it is not in the first chunk.
 */
import { duplicatePlanKeys } from '@/logic/syncApply'
import { db } from '../db'
import type { ID, Millis, Task } from '../types'
import { rebalanceGoal } from './goals'

const OPEN = ['todo', 'doing'] as const

/** The goal's open tasks (what a duplicate can be made of), by the compound `[goalId+status]` index. */
async function openTasks(goalId: ID): Promise<Task[]> {
  const found = await Promise.all(
    OPEN.map((status) => db.tasks.where('[goalId+status]').equals([goalId, status]).toArray()),
  )
  return found.flat()
}

/** Re-plans each goal that has two open plan tasks for one plan item. Returns the goals it re-planned. */
export async function healDuplicatePlanTasks(
  goalIds: readonly ID[],
  opts: { now?: Millis } = {},
): Promise<ID[]> {
  const healed: ID[] = []
  for (const goalId of new Set(goalIds)) {
    if (duplicatePlanKeys(await openTasks(goalId)).length === 0) continue
    await rebalanceGoal(goalId, { now: opts.now, reason: 'sync' })
    healed.push(goalId)
  }
  return healed
}
