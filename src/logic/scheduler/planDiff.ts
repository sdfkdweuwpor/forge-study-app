/**
 * Previews (pure): what a proposal would change in the stored plan, by item key. Nothing here writes;
 * the caller applies a change only after the user confirms it.
 */
import type { CurrentPlanItem, PlanChange, PlanItem, PlanMove } from './plannerTypes'

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The difference between the open stored items and a new plan: items whose slot changes, items the new
 * plan adds, and open items it no longer has. Done items and milestones are ignored; pinned items are
 * never reported as removed (the plan does not own them).
 */
export function diffPlanItems(
  current: readonly CurrentPlanItem[],
  next: readonly PlanItem[],
  cutUnitIds: ReadonlySet<string> = new Set(),
): PlanChange {
  const open = current.filter((c) => c.status === 'open' && c.kind !== 'milestone')
  const byKey = new Map(open.map((c) => [c.key, c]))
  const nextKeys = new Set<string>()
  const moved: PlanMove[] = []
  const added: PlanItem[] = []
  for (const n of next) {
    if (n.kind === 'milestone') continue
    nextKeys.add(n.key)
    const c = byKey.get(n.key)
    if (!c) {
      if (!current.some((x) => x.key === n.key)) added.push(n)
      continue
    }
    if (c.doDate !== n.doDate || c.startTime !== n.startTime)
      moved.push({
        key: n.key,
        title: n.title,
        from: { doDate: c.doDate, startTime: c.startTime },
        to: { doDate: n.doDate, startTime: n.startTime },
      })
  }
  const removed: PlanChange['removed'] = open
    .filter((c) => !nextKeys.has(c.key) && !c.pinned)
    .map((c) => ({
      key: c.key,
      title: c.title,
      reason:
        c.unitId !== null && cutUnitIds.has(c.unitId) ? ('cut' as const) : ('replanned' as const),
    }))
  return {
    moved: moved.sort((a, b) => cmpStr(a.key, b.key)),
    added,
    removed: removed.sort((a, b) => cmpStr(a.key, b.key)),
  }
}

export function isChangeEmpty(change: PlanChange): boolean {
  return change.moved.length === 0 && change.added.length === 0 && change.removed.length === 0
}
