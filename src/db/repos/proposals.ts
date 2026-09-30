/**
 * Keeping a goal's plan honest when life gets in the way (PLAN §4.5–4.6, schema v2).
 *
 * - `rollForwardGoal` moves missed work forward (`rollForward`: move-only, push-only). It is applied
 *   without asking only when the plan is slightly behind (`autoApply`). When it is far behind it writes
 *   the choices as `planProposals` rows (`status: 'pending'`) and changes nothing else.
 * - `proposeReplanWeek` ("life happened") is always a proposal.
 * - `applyProposal` applies one after the user confirms it, and returns an `undo()` that puts the goal,
 *   its units and its plan items back; the other pending proposals of the goal become stale.
 *   `dismissProposal` sets one aside (with undo). A proposal computed from a plan that has changed since
 *   (another day, or different open items: `baseRevision`) is not applied; it is marked stale.
 * - `runDailyPlanning` rolls every active goal forward once per day, at the first open.
 */
import {
  addMinutesToWindows,
  currentPlanItems,
  diffPlanTasks,
  goalAvailability,
  goalLivePlan,
  isChangeEmpty,
  isPlanTask,
  planRevision,
  replanWeek,
  rollForward,
  type BehindStatus,
  type PlanItem,
  type PlanChange,
  type Proposal,
  type ProposalApply,
} from '@/logic/scheduler'
import { dayOf, diffDays, startOfWeekISO } from '@/logic/dates'
import { minutesFromWeekly } from '@/logic/goalPlanning'
import { newId } from '@/lib/ids'
import { db } from '../db'
import { emit } from '../events'
import type {
  Goal,
  GoalProjection,
  ID,
  ISODate,
  Millis,
  Milestone,
  PlanProposal,
  PlanProposalKind,
  Task,
  Unit,
} from '../types'
import { rebalanceGoal } from './goals'
import { loadGoalRows, planTables, writePlanDiff, type WrittenDiff } from './planning'
import type { RepoOptions, Undoable } from './tasks'
import { moveToTrash, restoreFromTrash } from './trash'

/** What accepting a proposal does (stored in `PlanProposal.apply`). */
export interface ProposalApplyData extends ProposalApply {
  /** Move-only proposals (roll forward, "life happened"): the plan items to write as they are. */
  items?: PlanItem[]
  /** The finish those items reach. */
  projectedEnd?: ISODate | null
}

const APPLY_KEYS = new Set([
  'targetDate',
  'baselineEnd',
  'extraMinutesPerStudyDay',
  'cutUnitIds',
  'paceMinutesPerStudyDay',
  'items',
  'projectedEnd',
])

const isDateOrNull = (v: unknown): boolean =>
  v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))

function isPlanItem(v: unknown): v is PlanItem {
  if (typeof v !== 'object' || v === null) return false
  const i = v as Record<string, unknown>
  return (
    typeof i.key === 'string' &&
    typeof i.kind === 'string' &&
    typeof i.title === 'string' &&
    typeof i.doDate === 'string' &&
    typeof i.durationMinutes === 'number'
  )
}

/** Validates a stored `apply` before it is used (it is plain data from the database). */
export function parseProposalApply(v: unknown): ProposalApplyData | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const a = v as Record<string, unknown>
  if (Object.keys(a).some((k) => !APPLY_KEYS.has(k))) return null
  if ('targetDate' in a && !isDateOrNull(a.targetDate)) return null
  if ('baselineEnd' in a && !isDateOrNull(a.baselineEnd)) return null
  if ('projectedEnd' in a && !isDateOrNull(a.projectedEnd)) return null
  const extra = a.extraMinutesPerStudyDay
  if (extra !== undefined && (typeof extra !== 'number' || !(extra > 0) || extra > 24 * 60))
    return null
  const pace = a.paceMinutesPerStudyDay
  if (pace !== undefined && pace !== null && (typeof pace !== 'number' || !(pace > 0))) return null
  const cut = a.cutUnitIds
  if (cut !== undefined && (!Array.isArray(cut) || cut.some((x) => typeof x !== 'string')))
    return null
  const items = a.items
  if (items !== undefined && (!Array.isArray(items) || !items.every(isPlanItem))) return null
  return a as ProposalApplyData
}

// ─── Writing proposals ──────────────────────────────────────────────────────

function proposalRow(
  goalId: ID,
  kind: PlanProposalKind,
  p: { title: string; detail: string; apply: ProposalApplyData; change: PlanChange },
  ctx: { today: ISODate; now: Millis; revision: string },
): PlanProposal {
  return {
    id: newId(),
    createdAt: ctx.now,
    updatedAt: ctx.now,
    goalId,
    kind,
    status: 'pending',
    computedFor: ctx.today,
    title: p.title,
    detail: p.detail,
    apply: p.apply,
    preview: p.change,
    baseRevision: ctx.revision,
    decidedAt: null,
  }
}

/** Only move-only proposals carry their items; the others re-plan with the change applied. */
function applyFor(p: Proposal): ProposalApplyData {
  const move = p.kind === 'rollForward'
  return move ? { ...p.apply, items: p.items, projectedEnd: p.projectedEnd } : { ...p.apply }
}

/**
 * Marks the goal's pending proposals stale (inside the caller's transaction). Returns their ids.
 * `kinds` limits it to those kinds of proposal (default: all of them).
 */
async function staleProposals(
  goalId: ID,
  now: Millis,
  except?: ID,
  kinds?: readonly PlanProposalKind[],
): Promise<ID[]> {
  const pending = (await db.planProposals.where('goalId').equals(goalId).toArray()).filter(
    (p) =>
      p.status === 'pending' && p.id !== except && (kinds === undefined || kinds.includes(p.kind)),
  )
  for (const p of pending) await db.planProposals.update(p.id, { status: 'stale', updatedAt: now })
  return pending.map((p) => p.id)
}

/** The projection after items were moved (not re-planned): the new finish against the same references. */
function movedProjection(goal: Goal, end: ISODate | null, now: Millis): GoalProjection {
  const ref = goal.targetDate ?? goal.baselineEnd
  const prev = goal.projection
  return {
    end,
    slipDays: end !== null && ref !== null ? diffDays(end, ref) : null,
    feasible: goal.targetDate === null || end === null || end <= goal.targetDate,
    catchUpMinutes: prev?.catchUpMinutes ?? null,
    requiredMinutesPerStudyDay: prev?.requiredMinutesPerStudyDay ?? null,
    issues: prev?.issues ?? [],
    computedAt: now,
  }
}

/** Writes move-only plan items over the goal's plan tasks (inside the caller's transaction). */
async function writeItems(
  goalId: ID,
  tasks: readonly Task[],
  items: readonly PlanItem[],
  pinnedIds: ReadonlySet<ID>,
  today: ISODate,
  now: Millis,
): Promise<WrittenDiff> {
  const diff = diffPlanTasks(tasks.filter(isPlanTask), items, { today, pinnedIds })
  return writePlanDiff(goalId, diff, now)
}

// ─── Roll forward ───────────────────────────────────────────────────────────

export interface RollForwardOutcome {
  goalId: ID
  status: BehindStatus
  /** The roll-forward was written (on track with nothing to move writes nothing). */
  applied: boolean
  /** Far behind: the pending proposals written instead (nothing else changed). */
  proposals: PlanProposal[]
  written: WrittenDiff | null
}

/**
 * Rolls a goal's missed plan items forward as of today (`rollForward`). Slightly behind: applied, and
 * the projection follows. Far behind: the choices are written as pending proposals and nothing else
 * changes (earlier pending proposals of the goal become stale). `null` for a missing goal.
 */
export async function rollForwardGoal(
  goalId: ID,
  opts: RepoOptions = {},
): Promise<RollForwardOutcome | null> {
  const now = opts.now ?? Date.now()
  const today = dayOf(now)
  return db.transaction('rw', planTables(), async () => {
    const rows = await loadGoalRows(goalId, today)
    if (!rows) return null
    const { goal } = rows
    const { live, pinnedIds } = goalLivePlan(rows, today)
    const r = rollForward(live)

    if (!r.autoApply) {
      await staleProposals(goalId, now)
      const ctx = { today, now, revision: planRevision(live.current) }
      const proposals = r.proposals.map((p) =>
        proposalRow(goalId, p.kind, { ...p, apply: applyFor(p) }, ctx),
      )
      if (proposals.length > 0) await db.planProposals.bulkAdd(proposals)
      emit({ type: 'goal.changed', goalId })
      return { goalId, status: r.status, applied: false, proposals, written: null }
    }

    if (isChangeEmpty(r.change)) {
      if (goal.lastRebalancedOn !== today)
        await db.goals.update(goalId, { lastRebalancedOn: today })
      return { goalId, status: r.status, applied: false, proposals: [], written: null }
    }
    const written = await writeItems(goalId, rows.tasks, r.items, pinnedIds, today, now)
    await db.goals.update(goalId, {
      projection: movedProjection(goal, r.projectedEnd, now),
      lastRebalancedOn: today,
    })
    emit({ type: 'goal.changed', goalId })
    return { goalId, status: r.status, applied: true, proposals: [], written }
  })
}

export interface ReplanWeekRequest extends RepoOptions {
  /** Default: the start of this week (`settings.weekStartsOn`). */
  weekStart?: ISODate
  /** Days with no study at all this week. */
  blockedDays?: readonly ISODate[]
  /** Share of each remaining day's windows still usable (0–1). */
  capacityFactor?: number
}

/**
 * "Life happened": previews the rest of this week with less (or no) study time, its work pushed later,
 * and writes it as a pending `lifeHappened` proposal. Nothing else changes until it is applied; only an
 * earlier `lifeHappened` proposal becomes stale (the far-behind choices stay pending).
 * `null` for a missing goal.
 */
export async function proposeReplanWeek(
  goalId: ID,
  req: ReplanWeekRequest = {},
): Promise<PlanProposal | null> {
  const now = req.now ?? Date.now()
  const today = dayOf(now)
  return db.transaction('rw', planTables(), async () => {
    const rows = await loadGoalRows(goalId, today)
    if (!rows) return null
    const { live } = goalLivePlan(rows, today)
    const weekStart = req.weekStart ?? startOfWeekISO(today, rows.settings.weekStartsOn)
    const w = replanWeek(live, {
      weekStart,
      today,
      ...(req.blockedDays ? { blockedDays: req.blockedDays } : {}),
      ...(req.capacityFactor !== undefined ? { capacityFactor: req.capacityFactor } : {}),
    })
    // Only an earlier "life happened" preview is replaced: the far-behind choices are untouched by a
    // preview, so previewing and cancelling must leave them pending.
    await staleProposals(goalId, now, undefined, ['lifeHappened'])
    const moved = w.change.moved.length
    const row = proposalRow(
      goalId,
      'lifeHappened',
      {
        title:
          moved === 0
            ? 'Nothing to move this week'
            : `Move ${moved} ${moved === 1 ? 'session' : 'sessions'} later`,
        detail:
          w.projectedEnd === null
            ? 'The rest of this week is cleared.'
            : `The rest of this week is lighter. The plan now finishes around ${w.projectedEnd}.`,
        apply: { items: w.items, projectedEnd: w.projectedEnd },
        change: w.change,
      },
      { today, now, revision: planRevision(live.current) },
    )
    await db.planProposals.add(row)
    emit({ type: 'goal.changed', goalId })
    return row
  })
}

// ─── Deciding ───────────────────────────────────────────────────────────────

export type ApplyStatus = 'applied' | 'stale' | 'missing' | 'decided' | 'invalid'

export interface ApplyProposalResult extends Undoable {
  status: ApplyStatus
  proposal: PlanProposal | null
}

const noop = async (): Promise<void> => undefined

/** A goal's plan as it was before a change that re-plans it: what `restoreSnapshot` puts back. */
export interface Snapshot {
  goal: Goal
  units: Unit[]
  /** The goal's courses, when the change can touch them (plan settings rescale a course's hours). */
  milestones?: Milestone[]
  planTasks: Task[]
  proposals: PlanProposal[]
  trashIds: ID[]
}

/** A goal's rows as `restoreSnapshot` needs them; read them inside the caller's transaction, before the change. */
export function snapshotGoalPlan(
  goal: Goal,
  rows: { units: readonly Unit[]; milestones?: readonly Milestone[]; tasks: readonly Task[] },
): Snapshot {
  return {
    goal,
    units: [...rows.units],
    ...(rows.milestones ? { milestones: [...rows.milestones] } : {}),
    planTasks: rows.tasks.filter(isPlanTask),
    proposals: [],
    trashIds: [],
  }
}

/** Plan tasks the re-plan trashed (the person had added to them) come back before the snapshot is put over them. */
async function restoreTrashedPlanTasks(snap: Snapshot): Promise<void> {
  if (snap.planTasks.length === 0) return
  const ids = snap.planTasks.map((t) => t.id)
  const present = new Set((await db.tasks.bulkGet(ids)).flatMap((t) => (t ? [t.id] : [])))
  const missing = new Set(ids.filter((id) => !present.has(id)))
  if (missing.size === 0) return
  const entries = await db.trash.where('entityTable').equals('tasks').toArray()
  for (const entry of entries) {
    if (missing.has(entry.entityId)) await restoreFromTrash(entry.id)
  }
}

/** Puts a goal's plan back the way a snapshot saw it (the undo of an applied proposal or of a saved plan setting). */
export async function restoreSnapshot(snap: Snapshot): Promise<void> {
  for (const trashId of snap.trashIds) await restoreFromTrash(trashId)
  await restoreTrashedPlanTasks(snap)
  await db.transaction('rw', planTables(), async () => {
    const goalId = snap.goal.id
    if (!(await db.goals.get(goalId))) return
    const keepIds = new Set(snap.planTasks.map((t) => t.id))
    const added = (await db.tasks.where('goalId').equals(goalId).toArray()).filter(
      (t) => isPlanTask(t) && t.status !== 'done' && !keepIds.has(t.id),
    )
    if (added.length > 0) await db.tasks.bulkDelete(added.map((t) => t.id))
    for (const t of added) emit({ type: 'task.deleted', taskId: t.id })
    // Tasks finished since keep their completion; everything else is as it was.
    const current = new Map(
      (await db.tasks.bulkGet(snap.planTasks.map((t) => t.id))).flatMap((t) =>
        t ? [[t.id, t]] : [],
      ),
    )
    const back = snap.planTasks.filter((t) => current.get(t.id)?.status !== 'done')
    if (back.length > 0) await db.tasks.bulkPut(back)
    for (const t of back) emit({ type: 'task.changed', taskId: t.id })
    if (snap.units.length > 0) await db.units.bulkPut(snap.units)
    if (snap.milestones && snap.milestones.length > 0) await db.milestones.bulkPut(snap.milestones)
    await db.goals.put(snap.goal)
    if (snap.proposals.length > 0) await db.planProposals.bulkPut(snap.proposals)
    emit({ type: 'goal.changed', goalId })
  })
}

/**
 * Applies a pending proposal (the user confirmed it):
 * - roll forward and "life happened" write their items as they are (and, in ASAP mode, accept the new
 *   finish as the baseline);
 * - extend date sets the target; add time lengthens every study day's last window; cut scope moves the
 *   units to the trash; spread re-paces; each then re-plans the goal.
 * The proposal becomes `accepted` and the goal's other pending proposals `stale`. Nothing is applied when
 * the proposal is stale (computed on another day, or the open plan changed since): it is marked so.
 * `undo()` restores the goal, its units, its plan items and the proposals.
 */
export async function applyProposal(id: ID, opts: RepoOptions = {}): Promise<ApplyProposalResult> {
  const now = opts.now ?? Date.now()
  const today = dayOf(now)

  const step = await db.transaction('rw', planTables(), async () => {
    const p = await db.planProposals.get(id)
    if (!p) return { status: 'missing' as const, proposal: null }
    if (p.status !== 'pending') {
      return {
        status: p.status === 'stale' ? ('stale' as const) : ('decided' as const),
        proposal: p,
      }
    }
    const markStale = async () => {
      await db.planProposals.update(id, { status: 'stale', updatedAt: now })
      return { status: 'stale' as const, proposal: { ...p, status: 'stale' as const } }
    }
    const apply = parseProposalApply(p.apply)
    if (!apply) return { status: 'invalid' as const, proposal: p }
    if (p.goalId === null) return markStale()
    const rows = await loadGoalRows(p.goalId, today)
    if (!rows) return markStale()
    const revision = planRevision(currentPlanItems(rows.tasks, today))
    if (p.computedFor !== today || p.baseRevision !== revision) return markStale()

    const { goal } = rows
    const snap: Snapshot = {
      goal,
      units: [...rows.units],
      planTasks: rows.tasks.filter(isPlanTask),
      proposals: (await db.planProposals.where('goalId').equals(goal.id).toArray()).filter(
        (x) => x.status === 'pending',
      ),
      trashIds: [],
    }

    const kind = p.kind
    let replan = false
    if ((kind === 'rollForward' || kind === 'lifeHappened') && apply.items) {
      const { pinnedIds } = goalLivePlan(rows, today)
      await writeItems(goal.id, rows.tasks, apply.items, pinnedIds, today, now)
      const patch: Partial<Goal> = {
        projection: movedProjection(goal, apply.projectedEnd ?? goal.projection?.end ?? null, now),
      }
      if (apply.baselineEnd !== undefined) patch.baselineEnd = apply.baselineEnd
      await db.goals.update(goal.id, patch)
    } else {
      const patch: Partial<Goal> = {}
      if (apply.targetDate !== undefined) patch.targetDate = apply.targetDate
      if (apply.baselineEnd !== undefined) patch.baselineEnd = apply.baselineEnd
      if (apply.extraMinutesPerStudyDay !== undefined) {
        const extended = addMinutesToWindows(goalAvailability(goal), apply.extraMinutesPerStudyDay)
        const copy = (d: readonly { start: string; end: string }[]) =>
          d.map((w) => ({ start: w.start, end: w.end }))
        const weekly = extended.weekly.map(copy)
        const shift = extended.shiftPattern
        patch.planning = {
          ...goal.planning,
          weekly,
          shiftPattern: shift
            ? { anchor: shift.anchor, cycle: shift.cycle.map((d) => (d ? copy(d) : null)) }
            : null,
        }
        patch.availability = { ...goal.availability, minutesByWeekday: minutesFromWeekly(weekly) }
      }
      if (apply.paceMinutesPerStudyDay !== undefined) {
        patch.planning = {
          ...(patch.planning ?? goal.planning),
          paceMinutesPerStudyDay: apply.paceMinutesPerStudyDay,
        }
      }
      if (Object.keys(patch).length > 0) await db.goals.update(goal.id, patch)
      for (const unitId of apply.cutUnitIds ?? []) {
        const trashed = await moveToTrash('units', unitId, { now })
        if (trashed) snap.trashIds.push(trashed.trashId)
      }
      replan = true
    }
    await db.planProposals.update(id, { status: 'accepted', decidedAt: now, updatedAt: now })
    await staleProposals(goal.id, now, id)
    emit({ type: 'goal.changed', goalId: goal.id })
    return {
      status: 'applied' as const,
      proposal: { ...p, status: 'accepted' as const, decidedAt: now },
      snap,
      replan,
    }
  })

  if (step.status !== 'applied' || !('snap' in step)) {
    return { status: step.status, proposal: step.proposal, undo: noop }
  }
  if (step.replan) await rebalanceGoal(step.snap.goal.id, { now, reason: 'proposal' })
  const snap = step.snap
  return { status: 'applied', proposal: step.proposal, undo: () => restoreSnapshot(snap) }
}

/** Sets a pending proposal aside. `undo()` makes it pending again. `null` when it is not pending. */
export async function dismissProposal(id: ID, opts: RepoOptions = {}): Promise<Undoable | null> {
  const now = opts.now ?? Date.now()
  const before = await db.transaction('rw', db.planProposals, async () => {
    const p = await db.planProposals.get(id)
    if (!p || p.status !== 'pending') return null
    await db.planProposals.update(id, { status: 'dismissed', decidedAt: now, updatedAt: now })
    if (p.goalId !== null) emit({ type: 'goal.changed', goalId: p.goalId })
    return p
  })
  if (!before) return null
  return {
    undo: async () => {
      await db.transaction('rw', db.planProposals, async () => {
        const p = await db.planProposals.get(id)
        if (!p || p.status !== 'dismissed') return
        await db.planProposals.update(id, {
          status: 'pending',
          decidedAt: null,
          updatedAt: Date.now(),
        })
        if (p.goalId !== null) emit({ type: 'goal.changed', goalId: p.goalId })
      })
    },
  }
}

/** The goal's pending proposals for today, newest first (older ones are stale). */
export async function pendingProposals(goalId: ID, today: ISODate): Promise<PlanProposal[]> {
  return (await db.planProposals.where('goalId').equals(goalId).toArray())
    .filter((p) => p.status === 'pending' && p.computedFor === today)
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
}

// ─── The daily run ──────────────────────────────────────────────────────────

/**
 * At the first open of a day: rolls every active goal forward that was not planned today yet, then
 * records the day in `settings.scheduling.lastDailyRunDay` so later opens that day do nothing.
 * One goal failing does not stop the others; failures are returned.
 */
export async function runDailyPlanning(
  opts: RepoOptions = {},
): Promise<{ outcomes: RollForwardOutcome[]; errors: unknown[] }> {
  const now = opts.now ?? Date.now()
  const today = dayOf(now)
  const settings = await db.settings.get('app')
  if (settings?.scheduling.lastDailyRunDay === today) return { outcomes: [], errors: [] }
  const goals = (await db.goals.where('status').equals('active').toArray()).filter(
    (g) => g.lastRebalancedOn !== today,
  )
  const outcomes: RollForwardOutcome[] = []
  const errors: unknown[] = []
  for (const g of goals) {
    try {
      const out = await rollForwardGoal(g.id, { now })
      if (out) outcomes.push(out)
    } catch (error) {
      errors.push(error)
    }
  }
  if (settings) {
    await db.settings.update('app', {
      scheduling: { ...settings.scheduling, lastDailyRunDay: today },
    })
  }
  return { outcomes, errors }
}
