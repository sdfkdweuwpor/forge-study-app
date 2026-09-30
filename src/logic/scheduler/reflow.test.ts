import { describe, expect, it } from 'vitest'
import type { ISODate } from '@/db/types'
import { addDays, atTime } from '../dates'
import { planStudy } from './planner'
import { asCurrent, MON, pcourse, pinput } from './plannerFixtures'
import type { CurrentPlanItem, LivePlanInput, PlanItem, PlannerInput } from './plannerTypes'
import {
  behindStatus,
  FAR_BEHIND_MISSED_SHARE,
  FAR_BEHIND_SLIP_DAYS,
  replanWeek,
  rollForward,
} from './reflow'
import { addMinutesToWindows } from './windows'
import { withoutUnits } from './feasibility'

/** Plans `inp`, then looks at it from `today` with the given keys done. */
function live(inp: PlannerInput, today: ISODate, done: readonly string[] = []): LivePlanInput {
  const plan = planStudy(inp)
  return {
    ...inp,
    today,
    baselineEnd: plan.projectedEnd,
    current: asCurrent(plan.items, done),
    paceMinutesPerStudyDay: plan.pace.minutesPerStudyDay,
  }
}

const work = (items: readonly PlanItem[]) => items.filter((i) => i.kind !== 'milestone')
const slots = (items: readonly { key: string; doDate: string; startTime: string | null }[]) =>
  Object.fromEntries(items.map((i) => [i.key, `${i.doDate} ${i.startTime}`]))

/** Freezes the input deeply, so any write to it throws. */
function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x)) deepFreeze(v)
    Object.freeze(x)
  }
  return x
}

// Five 300-min units: 30 sessions of 50 min, two a day Mon–Fri, Oct 5 → Oct 23.
const asapPlan = () => pinput({ courses: [pcourse('a', [300, 300, 300, 300, 300])] })

describe('rollForward', () => {
  it('leaves an on-track plan exactly as it is (ASAP and paced)', () => {
    for (const inp of [asapPlan(), { ...asapPlan(), targetDate: '2026-11-30' }]) {
      const l = live(inp, MON)
      const r = rollForward(l)
      expect(r.change).toEqual({ moved: [], added: [], removed: [] })
      expect(r.status.level).toBe('onTrack')
      expect(r.autoApply).toBe(true)
      expect(r.proposals).toEqual([])
      expect(r.projectedEnd).toBe(r.previousEnd)
    }
  })

  it('moves a missed day to the next open slots and pushes the rest by one study day', () => {
    const l = live(asapPlan(), '2026-10-06') // Monday's two sessions were not done
    const before = slots(l.current)
    const r = rollForward(l)
    // One study day later: Friday Oct 23 → Monday Oct 26.
    expect(r.status).toMatchObject({
      level: 'slightlyBehind',
      missedCount: 2,
      missedMinutes: 100,
      slipDays: 3,
    })
    expect(r.autoApply).toBe(true)
    expect(r.previousEnd).toBe('2026-10-23')
    expect(r.projectedEnd).toBe('2026-10-26')
    const after = slots(work(r.items))
    expect(after['a-u1:1']).toBe('2026-10-06 18:00')
    expect(after['a-u1:2']).toBe('2026-10-06 19:00')
    expect(after['a-u1:3']).toBe('2026-10-07 18:00')
    expect(before['a-u1:3']).toBe('2026-10-06 18:00')
    // Keys, lengths and order are kept; nothing lands before today.
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
    const study = work(r.items).filter((i) => i.kind === 'study')
    for (let k = 1; k < study.length; k++)
      expect(
        `${study[k - 1]?.doDate} ${study[k - 1]?.startTime}` <
          `${study[k]?.doDate} ${study[k]?.startTime}`,
      ).toBe(true)
    expect(study.every((i) => i.doDate >= '2026-10-06')).toBe(true)
    expect(r.change.added).toEqual([])
    expect(r.change.removed).toEqual([])
  })

  it('lets a paced plan absorb a missed session in its headroom, without going over pace + one session', () => {
    const l = live({ ...asapPlan(), targetDate: '2026-12-18' }, '2026-10-08')
    expect(l.paceMinutesPerStudyDay).toBe(30)
    const missed = l.current.filter((c) => c.doDate < '2026-10-08')
    expect(missed.map((c) => c.key)).toEqual(['a-u1:1'])
    const r = rollForward(l)
    expect(r.status.level).toBe('slightlyBehind')
    expect(r.status.slipDays).toBe(0)
    expect(r.projectedEnd).toBe(r.previousEnd)
    expect(work(r.items).every((i) => i.doDate >= '2026-10-08')).toBe(true)
    // Per study day it never goes over the pace plus one session.
    const perDay = new Map<string, number>()
    for (const i of work(r.items))
      perDay.set(i.doDate, (perDay.get(i.doDate) ?? 0) + i.durationMinutes)
    for (const m of perDay.values()) expect(m).toBeLessThanOrEqual(30 + 90)
  })

  it('treats today’s items before `now` as missed when `now` is given', () => {
    const l = {
      ...live(asapPlan(), '2026-10-06', ['a-u1:1', 'a-u1:2']),
      now: atTime('2026-10-06', '18:55'),
    }
    const r = rollForward(l)
    expect(r.status.missedCount).toBe(1) // the 18:00 session
    expect(slots(work(r.items))['a-u1:3']).toBe('2026-10-06 18:55')
    expect(slots(work(r.items))['a-u1:4']).toBe('2026-10-07 18:00')
  })

  it('is far behind after a missed week: proposes, verifies, and applies nothing', () => {
    const inp = { ...asapPlan(), targetDate: '2026-10-30', settings: { bufferPct: 0.12 } }
    const l = deepFreeze(live(inp, '2026-10-12'))
    const snapshot = JSON.stringify(l)
    const r = rollForward(l)
    expect(JSON.stringify(l)).toBe(snapshot)
    expect(r.status.level).toBe('farBehind')
    expect(r.status.missedMinutes).toBe(400)
    expect(r.status.missedMinutes).toBeGreaterThan(
      FAR_BEHIND_MISSED_SHARE * r.status.remainingMinutes,
    )
    expect(r.status.reasons).toContain('missedWork')
    expect(r.autoApply).toBe(false)
    const kinds = r.proposals.map((p) => p.kind)
    expect(kinds).toEqual(['rollForward', 'extendDate', 'addTime', 'cutScope'])
    for (const p of r.proposals) {
      expect(p.title).not.toBe('')
      if (p.kind === 'rollForward') continue
      expect(p.fits).toBe(true)
      // Each claim is re-verified here with the change applied.
      const check =
        p.kind === 'extendDate'
          ? planStudy({ ...l, targetDate: p.apply.targetDate ?? null })
          : p.kind === 'addTime'
            ? planStudy({
                ...l,
                availability: addMinutesToWindows(
                  l.availability,
                  p.apply.extraMinutesPerStudyDay ?? 0,
                ),
              })
            : planStudy(withoutUnits(l, p.apply.cutUnitIds ?? []))
      expect(check.fits).toBe(true)
      expect(
        p.change.moved.length + p.change.added.length + p.change.removed.length,
      ).toBeGreaterThan(0)
    }
  })

  it('offers to spread the rest when a paced plan can still make it with more of its windows', () => {
    const inp = { ...asapPlan(), targetDate: '2026-11-13', settings: { bufferPct: 0.12 } }
    const l = live(inp, '2026-10-19')
    const r = rollForward(l)
    expect(r.status.level).toBe('farBehind')
    const spread = r.proposals.find((p) => p.kind === 'spread')
    expect(spread).toBeDefined()
    expect(spread?.apply.paceMinutesPerStudyDay).toBeGreaterThan(l.paceMinutesPerStudyDay ?? 0)
    expect(planStudy({ ...l }).fits).toBe(true)
  })

  it('classifies slip over 7 days as far behind, and only accepting the new date in ASAP mode', () => {
    const l = live(asapPlan(), '2026-10-19', [
      'a-u1:1',
      'a-u1:2',
      'a-u1:3',
      'a-u1:4',
      'a-u1:5',
      'a-u1:6',
    ])
    const s = behindStatus(l)
    expect(s.slipDays).toBeGreaterThan(FAR_BEHIND_SLIP_DAYS)
    expect(s.level).toBe('farBehind')
    const r = rollForward(l)
    // ASAP: "extend the date" is accepting the new end; time and scope are measured against the old one.
    expect(r.proposals.map((p) => p.kind)).toEqual(['rollForward', 'addTime', 'cutScope'])
    expect(r.proposals[0]?.apply).toEqual({ baselineEnd: r.projectedEnd })
  })

  it('moves a missed review before its assessment, or drops it when no slot is left', () => {
    const inp = pinput({
      courses: [pcourse('a', [100])],
      assessments: [
        { id: 'x', courseId: 'a', kind: 'exam', title: 'Exam', date: '2026-10-16', time: '09:00' },
      ],
    })
    const plan = planStudy(inp)
    const r1 = plan.items.find((i) => i.key === 'review:x:1') as PlanItem
    expect(r1.doDate).toBe('2026-10-07')
    const moved = rollForward(live(inp, '2026-10-08', ['a-u1:1', 'a-u1:2']))
    const at = work(moved.items).find((i) => i.key === 'review:x:1') as PlanItem
    expect(at.doDate >= '2026-10-08' && at.doDate < '2026-10-16').toBe(true)
    const late = rollForward(live(inp, '2026-10-16', ['a-u1:1', 'a-u1:2']))
    expect(late.change.removed).toContainEqual({
      key: 'review:x:1',
      title: expect.any(String),
      reason: 'noSlotBeforeAssessment',
    })
    expect(late.status.reasons).toContain('reviewDropped')
  })
})

describe('replanWeek ("life happened")', () => {
  const inp = asapPlan()

  it('clears the rest of this week and moves its work later, as a preview', () => {
    const l = deepFreeze(live(inp, '2026-10-07', ['a-u1:1', 'a-u1:2', 'a-u1:3', 'a-u1:4']))
    const snapshot = JSON.stringify(l)
    const w = replanWeek(l, { weekStart: MON, today: '2026-10-07' })
    expect(JSON.stringify(l)).toBe(snapshot)
    expect(w.weekStart).toBe(MON)
    expect(w.weekEnd).toBe('2026-10-11')
    const items = work(w.items)
    expect(items.some((i) => i.doDate >= '2026-10-07' && i.doDate <= '2026-10-11')).toBe(false)
    expect(slots(items)['a-u1:5']).toBe('2026-10-12 18:00')
    // Three study days' work (Wed–Fri) moves: the end slips by three study days.
    expect(w.previousEnd).toBe('2026-10-23')
    expect(w.projectedEnd).toBe('2026-10-28')
    expect(w.change.moved.length).toBe(26)
  })

  it('blocks only the given days when blockedDays are passed', () => {
    const l = live(inp, '2026-10-07', ['a-u1:1', 'a-u1:2', 'a-u1:3', 'a-u1:4'])
    const w = replanWeek(l, { weekStart: MON, today: '2026-10-07', blockedDays: ['2026-10-08'] })
    const days = new Set(work(w.items).map((i) => i.doDate))
    expect(days.has('2026-10-07')).toBe(true)
    expect(days.has('2026-10-08')).toBe(false)
    expect(days.has('2026-10-09')).toBe(true)
    expect(w.projectedEnd).toBe('2026-10-26')
  })

  it('keeps only part of each window with a capacity factor', () => {
    const l = live(inp, '2026-10-07', ['a-u1:1', 'a-u1:2', 'a-u1:3', 'a-u1:4'])
    const w = replanWeek(l, { weekStart: MON, today: '2026-10-07', capacityFactor: 0.5 })
    const thisWeek = work(w.items).filter((i) => i.doDate <= '2026-10-11')
    expect(thisWeek.map((i) => [i.doDate, i.startTime])).toEqual([
      ['2026-10-07', '18:00'],
      ['2026-10-08', '18:00'],
      ['2026-10-09', '18:00'],
    ])
    expect(w.status.level).toBe('slightlyBehind')
  })

  it('moves a pinned session off a cleared day, keeping plan order', () => {
    const l = live(inp, '2026-10-07', ['a-u1:1', 'a-u1:2', 'a-u1:3', 'a-u1:4'])
    const pinned: CurrentPlanItem[] = l.current.map((c) =>
      c.key === 'a-u2:1' ? { ...c, pinned: true } : c,
    )
    expect(pinned.find((c) => c.key === 'a-u2:1')?.doDate).toBe('2026-10-08')
    const w = replanWeek({ ...l, current: pinned }, { weekStart: MON, today: '2026-10-07' })
    expect(w.change.moved.find((m) => m.key === 'a-u2:1')?.to).toEqual({
      doDate: addDays('2026-10-11', 2),
      startTime: '18:00',
    })
  })
})
