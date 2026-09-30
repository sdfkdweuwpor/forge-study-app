/**
 * Behind handling (schema v2): the daily roll-forward applies itself only when slightly behind; far
 * behind writes pending proposals and changes nothing else; proposals are applied or dismissed with Undo;
 * "life happened" is a proposal too.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { resetDomainEvents, settleDomainEvents } from '@/db/events'
import { rebalanceGoal } from '@/db/repos/goals'
import {
  applyProposal,
  dismissProposal,
  parseProposalApply,
  pendingProposals,
  proposeReplanWeek,
  rollForwardGoal,
  runDailyPlanning,
} from '@/db/repos/proposals'
import { ensureSettings } from '@/db/repos/settings'
import { completeTask } from '@/db/repos/tasks'
import type { Task } from '@/db/types'
import { atTime } from '@/logic/dates'
import { avail, goalRow, milestoneRow, unitRow, week } from '@/logic/scheduler/fixtures'

const MON = atTime('2026-10-05', '08:00')
const at = (day: string, time = '08:00') => atTime(day, time)

beforeEach(async () => {
  resetDomainEvents()
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

/** Course A (120 + 180 min) then B (150 min); Mon–Fri 09:00–10:00, Sat 09:00–11:00; planned Monday. */
async function seedPlanned(extra: Parameters<typeof goalRow>[0] = {}): Promise<void> {
  await db.goals.add(goalRow({ availability: avail(week(60, 120, 0)), ...extra }))
  await db.milestones.bulkAdd([
    milestoneRow('a', { order: 0, status: 'active' }),
    milestoneRow('b', { order: 1 }),
  ])
  await db.units.bulkAdd([
    unitRow('a1', 'a', 120),
    unitRow('a2', 'a', 180, { order: 1 }),
    unitRow('b1', 'b', 150),
  ])
  await rebalanceGoal('goal-1', { now: MON, reason: 'wizard' })
}

const planTasks = async (): Promise<Task[]> =>
  (await db.tasks.toArray())
    .filter((t) => t.source === 'schedule')
    .sort((x, y) => x.id.localeCompare(y.id))

const byKey = async (key: string): Promise<Task> =>
  (await db.tasks.where('scheduleKey').equals(key).first()) as Task

describe('rollForwardGoal', () => {
  it('slightly behind: moves the missed session forward by itself', async () => {
    await seedPlanned()
    const out = await rollForwardGoal('goal-1', { now: at('2026-10-06') })
    expect(out).toMatchObject({ applied: true, proposals: [] })
    expect(out?.status).toMatchObject({ level: 'slightlyBehind', missedCount: 1 })
    expect(await byKey('a1:1')).toMatchObject({ doDate: '2026-10-06', doTime: '09:00' })
    const open = (await planTasks()).filter((t) => t.status !== 'done' && t.kind === 'study')
    expect(open.every((t) => (t.doDate as string) >= '2026-10-06')).toBe(true)
    const goal = await db.goals.get('goal-1')
    expect(goal?.lastRebalancedOn).toBe('2026-10-06')
    expect(goal?.projection?.end).toBe('2026-10-13')
    expect(await db.planProposals.count()).toBe(0)
  })

  it('far behind: writes pending proposals and changes nothing else', async () => {
    await seedPlanned()
    const tasksBefore = await planTasks()
    const goalBefore = await db.goals.get('goal-1')
    const out = await rollForwardGoal('goal-1', { now: at('2026-10-12') })
    expect(out?.applied).toBe(false)
    expect(out?.status.level).toBe('farBehind')
    expect(out?.proposals.map((p) => p.kind)).toEqual(['rollForward'])
    expect(await planTasks()).toEqual(tasksBefore)
    expect(await db.goals.get('goal-1')).toEqual(goalBefore)
    const rows = await pendingProposals('goal-1', '2026-10-12')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'pending',
      computedFor: '2026-10-12',
      title: 'Accept the new finish date, Oct 20',
      decidedAt: null,
    })
    expect(rows[0]?.preview.moved.length).toBeGreaterThan(0)
    expect(parseProposalApply(rows[0]?.apply)).not.toBeNull()
  })

  it('a later run makes the earlier proposals stale', async () => {
    await seedPlanned()
    await rollForwardGoal('goal-1', { now: at('2026-10-12') })
    await rollForwardGoal('goal-1', { now: at('2026-10-12', '12:00') })
    const all = await db.planProposals.toArray()
    expect(all.filter((p) => p.status === 'pending')).toHaveLength(1)
    expect(all.filter((p) => p.status === 'stale')).toHaveLength(1)
  })
})

describe('applyProposal and dismissProposal', () => {
  it('applies a roll-forward after confirmation; Undo puts the plan and the proposals back', async () => {
    await seedPlanned()
    const now = at('2026-10-12')
    const out = await rollForwardGoal('goal-1', { now })
    const id = out?.proposals[0]?.id as string
    const tasksBefore = await planTasks()
    const goalBefore = await db.goals.get('goal-1')

    const result = await applyProposal(id, { now: now + 1000 })
    expect(result.status).toBe('applied')
    const open = (await planTasks()).filter((t) => t.status !== 'done' && t.kind === 'study')
    expect(open.every((t) => (t.doDate as string) >= '2026-10-12')).toBe(true)
    const goal = await db.goals.get('goal-1')
    // ASAP: accepting means the new finish is the baseline.
    expect(goal?.baselineEnd).toBe('2026-10-20')
    expect(goal?.projection?.end).toBe('2026-10-20')
    expect(await db.planProposals.get(id)).toMatchObject({ status: 'accepted' })
    expect(await applyProposal(id, { now: now + 2000 })).toMatchObject({ status: 'decided' })

    await result.undo()
    expect(await planTasks()).toEqual(tasksBefore)
    expect(await db.goals.get('goal-1')).toEqual(goalBefore)
    expect((await db.planProposals.get(id))?.status).toBe('pending')
  })

  it('an extend-date proposal moves the target and re-plans; the others go stale', async () => {
    await seedPlanned({ targetDate: '2026-10-24' })
    const now = at('2026-10-14')
    const out = await rollForwardGoal('goal-1', { now })
    expect(out?.proposals.map((p) => p.kind)).toEqual([
      'rollForward',
      'extendDate',
      'addTime',
      'cutScope',
    ])
    const extend = out?.proposals.find((p) => p.kind === 'extendDate')
    const result = await applyProposal(extend?.id as string, { now: now + 1000 })
    expect(result.status).toBe('applied')
    const goal = await db.goals.get('goal-1')
    expect(goal?.targetDate).toBe('2026-11-02')
    expect(goal?.projection?.feasible).toBe(true)
    const statuses = (await db.planProposals.toArray()).map((p) => [p.kind, p.status])
    expect(statuses).toContainEqual(['extendDate', 'accepted'])
    expect(statuses.filter(([, s]) => s === 'stale')).toHaveLength(3)

    await result.undo()
    expect((await db.goals.get('goal-1'))?.targetDate).toBe('2026-10-24')
    expect((await pendingProposals('goal-1', '2026-10-14')).length).toBe(4)
  })

  it('add time lengthens the study windows and keeps the minutes in step', async () => {
    await seedPlanned({ targetDate: '2026-10-24' })
    const now = at('2026-10-14')
    const out = await rollForwardGoal('goal-1', { now })
    const add = out?.proposals.find((p) => p.kind === 'addTime')
    expect((await applyProposal(add?.id as string, { now: now + 1000 })).status).toBe('applied')
    const goal = await db.goals.get('goal-1')
    expect(goal?.planning.weekly[1]).toEqual([{ start: '09:00', end: '10:10' }])
    expect(goal?.availability.minutesByWeekday).toEqual([0, 70, 70, 70, 70, 70, 130])
  })

  it('cut scope moves the units to the trash; Undo brings them back', async () => {
    await seedPlanned({ targetDate: '2026-10-24' })
    const now = at('2026-10-14')
    const out = await rollForwardGoal('goal-1', { now })
    const cut = out?.proposals.find((p) => p.kind === 'cutScope')
    const result = await applyProposal(cut?.id as string, { now: now + 1000 })
    expect(result.status).toBe('applied')
    expect(await db.units.get('a2')).toBeUndefined()
    expect((await planTasks()).some((t) => t.unitId === 'a2' && t.status !== 'done')).toBe(false)
    await result.undo()
    expect(await db.units.get('a2')).toBeDefined()
    expect((await planTasks()).some((t) => t.unitId === 'a2')).toBe(true)
  })

  it('a proposal from before the plan changed is stale and applies nothing', async () => {
    await seedPlanned()
    const now = at('2026-10-12')
    const out = await rollForwardGoal('goal-1', { now })
    await completeTask((await byKey('a1:1')).id, { now: now + 500 })
    const before = await planTasks()
    const result = await applyProposal(out?.proposals[0]?.id as string, { now: now + 1000 })
    expect(result.status).toBe('stale')
    expect(await planTasks()).toEqual(before)
    // And one from another day.
    const again = await rollForwardGoal('goal-1', { now: now + 2000 })
    const tomorrow = await applyProposal(again?.proposals[0]?.id as string, {
      now: at('2026-10-13'),
    })
    expect(tomorrow.status).toBe('stale')
  })

  it('dismisses a proposal, with Undo', async () => {
    await seedPlanned()
    const out = await rollForwardGoal('goal-1', { now: at('2026-10-12') })
    const id = out?.proposals[0]?.id as string
    const dismissed = await dismissProposal(id, { now: at('2026-10-12', '09:00') })
    expect(await db.planProposals.get(id)).toMatchObject({ status: 'dismissed' })
    expect(await dismissProposal(id)).toBeNull()
    await dismissed?.undo()
    expect(await db.planProposals.get(id)).toMatchObject({ status: 'pending', decidedAt: null })
  })

  it('rejects malformed apply data', () => {
    expect(parseProposalApply({ targetDate: 'soon' })).toBeNull()
    expect(parseProposalApply({ extraMinutesPerStudyDay: -5 })).toBeNull()
    expect(parseProposalApply({ surprise: true })).toBeNull()
    expect(parseProposalApply({ cutUnitIds: ['a2'] })).toEqual({ cutUnitIds: ['a2'] })
  })
})

describe('proposeReplanWeek ("life happened")', () => {
  it('is a pending proposal; applying it clears the rest of the week', async () => {
    await seedPlanned()
    const now = at('2026-10-07')
    const before = await planTasks()
    const proposal = await proposeReplanWeek('goal-1', { now })
    expect(proposal).toMatchObject({ kind: 'lifeHappened', status: 'pending' })
    expect(await planTasks()).toEqual(before)

    const result = await applyProposal(proposal?.id as string, { now: now + 1000 })
    expect(result.status).toBe('applied')
    const thisWeek = (await planTasks()).filter(
      (t) =>
        t.kind === 'study' &&
        t.status !== 'done' &&
        (t.doDate as string) >= '2026-10-07' &&
        (t.doDate as string) <= '2026-10-11',
    )
    expect(thisWeek).toEqual([])
  })
})

describe('proposeReplanWeek and the far-behind choices', () => {
  it('previewing and dismissing "life happened" leaves the far-behind proposals pending', async () => {
    await seedPlanned()
    const far = at('2026-10-12')
    const out = await rollForwardGoal('goal-1', { now: far })
    expect(out?.proposals.length).toBeGreaterThan(0)
    const before = (await pendingProposals('goal-1', '2026-10-12')).map((p) => p.id).sort()

    const preview = await proposeReplanWeek('goal-1', { now: far, capacityFactor: 0.5 })
    expect(preview?.kind).toBe('lifeHappened')
    await dismissProposal(preview?.id as string, { now: far })

    const after = await pendingProposals('goal-1', '2026-10-12')
    expect(after.map((p) => p.id).sort()).toEqual(before)
    expect(after.every((p) => p.kind !== 'lifeHappened')).toBe(true)
  })

  it('a second preview replaces the first; applying one makes the others stale', async () => {
    await seedPlanned()
    const far = at('2026-10-12')
    await rollForwardGoal('goal-1', { now: far })
    const first = await proposeReplanWeek('goal-1', { now: far, capacityFactor: 0.5 })
    const second = await proposeReplanWeek('goal-1', { now: far, capacityFactor: 0.25 })
    expect((await db.planProposals.get(first?.id as string))?.status).toBe('stale')
    expect((await db.planProposals.get(second?.id as string))?.status).toBe('pending')
    expect((await pendingProposals('goal-1', '2026-10-12')).some((p) => p.kind !== 'lifeHappened')).toBe(
      true,
    )
    const applied = await applyProposal(second?.id as string, { now: far })
    expect(applied.status).toBe('applied')
    expect(await pendingProposals('goal-1', '2026-10-12')).toEqual([])
  })
})

describe('runDailyPlanning', () => {
  it('runs once per day, and skips goals already planned today', async () => {
    await ensureSettings()
    await seedPlanned()
    // Planned Monday: nothing to do on Monday.
    expect((await runDailyPlanning({ now: MON })).outcomes).toEqual([])
    const tuesday = await runDailyPlanning({ now: at('2026-10-06') })
    expect(tuesday.outcomes.map((o) => o.applied)).toEqual([true])
    expect((await db.settings.get('app'))?.scheduling.lastDailyRunDay).toBe('2026-10-06')
    expect((await runDailyPlanning({ now: at('2026-10-06', '15:00') })).outcomes).toEqual([])
  })
})
