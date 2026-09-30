/**
 * "Import" for real: write the plan, re-plan the goal (`rebalanceGoal`, reason `import`) and hand back
 * an undo. The parse and preview happen before this; this only runs from the Import button.
 */
import { rebalanceGoal, type RebalanceSummary } from '@/db/repos/goals'
import type { ID } from '@/db/types'
import { dayOf } from '@/logic/dates'
import { hasWrites, type ImportPreview, type Plan } from '@/logic/planImport'
import { applyPlanImport, type ImportTarget } from './queries'

export interface ImportRun {
  goalId: ID
  mode: 'create' | 'merge'
  /** What the preview promised; what was written. */
  totals: ImportPreview['totals']
  /** False when the plan matched the goal already and nothing was written. */
  wrote: boolean
  rebalance: RebalanceSummary | null
  /** Set when the data was imported but the schedule could not be rebuilt (Rebalance now fixes it). */
  rebalanceError: string | null
  /** Puts the goal back as it was and re-plans it. */
  undo: () => Promise<void>
}

export async function runImport(
  plan: Plan,
  target: ImportTarget,
  opts: { now?: number } = {},
): Promise<ImportRun> {
  const now = opts.now ?? Date.now()
  const applied = await applyPlanImport(plan, target, dayOf(now))

  let rebalance: RebalanceSummary | null = null
  let rebalanceError: string | null = null
  try {
    rebalance = await rebalanceGoal(applied.goalId, { reason: 'import', now })
  } catch (e) {
    rebalanceError = e instanceof Error ? e.message : 'The schedule could not be rebuilt.'
  }

  return {
    goalId: applied.goalId,
    mode: applied.created ? 'create' : 'merge',
    totals: applied.ops.preview.totals,
    wrote: hasWrites(applied.ops),
    rebalance,
    rebalanceError,
    undo: async () => {
      await applied.revert()
      if (!applied.created) await rebalanceGoal(applied.goalId, { reason: 'import' })
    },
  }
}
