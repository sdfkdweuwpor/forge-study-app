import { describe, expect, it } from 'vitest'
import type { GoalProjection, Milestone, WguTerm } from '@/db/types'
import { atTime } from './dates'
import {
  carryEndMove,
  courseLabel,
  currentTerm,
  formatDay,
  formatHours,
  percent,
  plural,
  sortCourses,
  summarizeFinish,
  termProgress,
} from './goalDisplay'

const TODAY = '2026-09-29'

function projection(extra: Partial<GoalProjection> = {}): GoalProjection {
  return {
    end: '2027-03-14',
    slipDays: 0,
    feasible: true,
    catchUpMinutes: null,
    requiredMinutesPerStudyDay: null,
    issues: [],
    computedAt: 0,
    ...extra,
  }
}

const goal = (p: GoalProjection | null, targetDate: string | null = '2027-03-28') => ({
  projection: p,
  targetDate,
  status: 'active' as const,
})

describe('percent, hours and days', () => {
  it('rounds and clamps', () => {
    expect(percent(0, 0)).toBe(0)
    expect(percent(5, 0)).toBe(0)
    expect(percent(1, 3)).toBe(33)
    expect(percent(2, 3)).toBe(67)
    expect(percent(10, 8)).toBe(100)
    expect(percent(-1, 8)).toBe(0)
    expect(percent(Number.NaN, 8)).toBe(0)
  })

  it('formats hours with at most one decimal', () => {
    expect(formatHours(0)).toBe('0')
    expect(formatHours(60)).toBe('1')
    expect(formatHours(90)).toBe('1.5')
    expect(formatHours(2400)).toBe('40')
    expect(formatHours(605)).toBe('10.1')
    expect(formatHours(-5)).toBe('0')
  })

  it('formats days, with the year only when it differs', () => {
    expect(formatDay('2027-03-14', TODAY)).toBe('Mar 14, 2027')
    expect(formatDay('2026-12-03', TODAY)).toBe('Dec 3')
  })

  it('pluralises', () => {
    expect(plural(1, 'day')).toBe('1 day')
    expect(plural(9, 'day')).toBe('9 days')
  })
})

describe('summarizeFinish', () => {
  it('says a plan has not been made yet', () => {
    expect(summarizeFinish(goal(null), TODAY)).toMatchObject({
      kind: 'unscheduled',
      tone: 'neutral',
      headline: 'Not scheduled yet',
      target: 'Target Mar 28, 2027',
    })
  })

  it('describes a slip gently: neutral when small, amber when larger, never an alarm', () => {
    const behind = summarizeFinish(goal(projection({ slipDays: 9, feasible: false })), TODAY)
    expect(behind).toMatchObject({
      kind: 'behind',
      tone: 'warning',
      headline: 'Projected Mar 14, 2027 · 9 days after target',
      end: 'Mar 14, 2027',
      slip: '9 days after target',
    })
    expect(summarizeFinish(goal(projection({ slipDays: 7, feasible: false })), TODAY).tone).toBe(
      'neutral',
    )
    expect(summarizeFinish(goal(projection({ slipDays: 8, feasible: false })), TODAY).tone).toBe(
      'warning',
    )
    expect(summarizeFinish(goal(projection({ slipDays: 1, feasible: false })), TODAY).slip).toBe(
      '1 day after target',
    )
    // However far behind, there is no danger tone and no alarming words.
    const far = summarizeFinish(goal(projection({ slipDays: 200, feasible: false })), TODAY)
    expect(far.tone).toBe('warning')
    expect(far.headline).not.toMatch(/late|behind|overdue|fail|miss|impossible|can’t|cannot/i)
  })

  it('measures against the plan when there is no target', () => {
    expect(summarizeFinish(goal(projection({ slipDays: 3 }), null), TODAY).headline).toBe(
      'Projected Mar 14, 2027 · 3 days after your plan',
    )
    expect(summarizeFinish(goal(projection({ slipDays: -3 }), null), TODAY).headline).toBe(
      'Projected Mar 14, 2027 · 3 days before your plan',
    )
  })

  it('is positive when on time or ahead', () => {
    expect(summarizeFinish(goal(projection({ slipDays: 0 })), TODAY)).toMatchObject({
      kind: 'onTrack',
      tone: 'success',
      headline: 'On track · finishing Mar 14, 2027',
    })
    expect(summarizeFinish(goal(projection({ slipDays: -14 })), TODAY)).toMatchObject({
      kind: 'ahead',
      tone: 'success',
      headline: 'Projected Mar 14, 2027 · 14 days before target',
      slip: '14 days before target',
    })
  })

  it('has no slip when there is nothing to measure against', () => {
    expect(summarizeFinish(goal(projection({ slipDays: null }), null), TODAY)).toMatchObject({
      kind: 'projected',
      headline: 'Projected Mar 14, 2027',
      target: null,
      slip: null,
    })
  })

  it('explains a plan that never ends without raising an alarm', () => {
    const none = summarizeFinish(
      goal(projection({ end: null, slipDays: null, feasible: false, issues: ['NO_AVAILABILITY'] })),
      TODAY,
    )
    expect(none).toMatchObject({
      kind: 'unfinishable',
      tone: 'neutral',
      headline: 'No finish date yet',
    })
    expect(none.note).toContain('study days')
    const far = summarizeFinish(
      goal(
        projection({ end: null, slipDays: null, feasible: false, issues: ['HORIZON_EXCEEDED'] }),
      ),
      TODAY,
    )
    expect(far).toMatchObject({ kind: 'unfinishable', tone: 'warning' })
    expect(far.note).toContain('More study time')
    expect(summarizeFinish(goal(projection({ end: null, slipDays: null })), TODAY)).toMatchObject({
      kind: 'done',
      headline: 'Nothing left to schedule',
    })
  })

  it('a finished goal is complete whatever its projection says', () => {
    expect(
      summarizeFinish(
        { projection: projection({ slipDays: 30 }), targetDate: null, status: 'done' },
        TODAY,
      ),
    ).toMatchObject({ kind: 'done', tone: 'success', headline: 'Completed' })
  })
})

describe('WGU term progress', () => {
  const t1: WguTerm = { id: 't1', label: 'Term 1', start: '2026-08-01', end: '2027-01-31' }
  const t2: WguTerm = { id: 't2', label: 'Term 2', start: '2027-02-01', end: '2027-07-31' }

  const course = (
    id: string,
    extra: Partial<Milestone> = {},
  ): Pick<Milestone, 'id' | 'status' | 'cus' | 'termId' | 'projectedEnd' | 'completedAt'> => ({
    id,
    status: 'todo',
    cus: 3,
    termId: null,
    projectedEnd: null,
    completedAt: null,
    ...extra,
  })

  it('picks the term that contains today, else the latest that started, else the first', () => {
    expect(currentTerm([], TODAY)).toBeNull()
    expect(currentTerm([t2, t1], TODAY)?.id).toBe('t1')
    expect(currentTerm([t1, t2], '2027-03-01')?.id).toBe('t2')
    expect(currentTerm([t1, t2], '2027-08-15')?.id).toBe('t2')
    expect(currentTerm([t1, t2], '2026-01-01')?.id).toBe('t1')
  })

  it('counts assigned courses', () => {
    const p = termProgress(
      [t1],
      [
        course('a', { status: 'done', cus: 4, termId: 't1' }),
        course('b', { status: 'active', cus: 3, termId: 't1' }),
        course('c', { status: 'todo', cus: 3, termId: 't2' }),
      ],
      TODAY,
    )
    expect(p).toMatchObject({ done: 4, total: 7, courses: 2, coursesDone: 1, daysLeft: 124 })
    expect(p?.term.id).toBe('t1')
  })

  it('places unassigned courses by date: finished or projected inside the term', () => {
    const p = termProgress(
      [t1],
      [
        // Done, and finished inside the term.
        course('a', { status: 'done', cus: 4, completedAt: atTime('2026-09-01', '15:00') }),
        // Done before the term began: not this term's.
        course('b', { status: 'done', cus: 3, completedAt: atTime('2026-07-01', '15:00') }),
        // Done with no completion time: its projected end decides.
        course('c', { status: 'done', cus: 3, projectedEnd: '2026-10-01' }),
        // Open, projected to finish in the term, and one that spills over.
        course('d', { status: 'active', cus: 3, projectedEnd: '2026-12-15' }),
        course('e', { status: 'todo', cus: 4, projectedEnd: '2027-03-01' }),
        // No dates at all: not counted.
        course('f', { status: 'todo', cus: 3 }),
      ],
      TODAY,
    )
    expect(p).toMatchObject({ done: 7, total: 10, courses: 3, coursesDone: 2 })
  })

  it('treats a missing CU count as zero and ignores duplicate rows', () => {
    const rows = [
      course('a', { status: 'done', cus: null, termId: 't1' }),
      course('a', { termId: 't1' }),
    ]
    expect(termProgress([t1], rows, TODAY)).toMatchObject({ done: 0, total: 0, courses: 1 })
  })

  it('has no progress without a term', () => {
    expect(termProgress([], [course('a')], TODAY)).toBeNull()
  })

  it('reports days left as negative once the term is over', () => {
    expect(termProgress([t1], [], '2027-02-10')?.daysLeft).toBe(-10)
  })
})

describe('course helpers', () => {
  it('sorts by order, then age, then id', () => {
    const rows = [
      { id: 'c', order: 1, createdAt: 5 },
      { id: 'b', order: 0, createdAt: 9 },
      { id: 'a', order: 0, createdAt: 9 },
      { id: 'd', order: 0, createdAt: 1 },
    ]
    expect(sortCourses(rows).map((r) => r.id)).toEqual(['d', 'a', 'b', 'c'])
    // The input is left alone.
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('labels courses with their code when they have one', () => {
    expect(courseLabel({ code: 'C182', title: 'Introduction to IT' })).toBe(
      'C182 Introduction to IT',
    )
    expect(courseLabel({ code: null, title: 'Capstone' })).toBe('Capstone')
    expect(courseLabel({ code: '', title: 'Capstone' })).toBe('Capstone')
  })
})

describe('the projection moved', () => {
  const NOW = atTime(TODAY, '09:00')

  it('remembers the old end when the end moves, and keeps it while the end stays', () => {
    const before = projection({ end: '2027-03-14' })
    const moved = carryEndMove(before, projection({ end: '2027-03-23' }), NOW)
    expect(moved).toMatchObject({ previousEnd: '2027-03-14', endMovedAt: NOW })
    const again = carryEndMove(moved, projection({ end: '2027-03-23' }), NOW + 1000)
    expect(again).toMatchObject({ previousEnd: '2027-03-14', endMovedAt: NOW })
    expect(carryEndMove(null, projection(), NOW)).toMatchObject({
      previousEnd: null,
      endMovedAt: null,
    })
  })

  it('says how far it moved for a week: "Now projected Mar 23 (+9 days)"', () => {
    const p = projection({
      end: '2027-03-23',
      slipDays: null,
      previousEnd: '2027-03-14',
      endMovedAt: NOW,
    })
    expect(summarizeFinish(goal(p, null), TODAY).headline).toBe(
      'Now projected Mar 23, 2027 (+9 days)',
    )
    const earlier = projection({
      end: '2027-03-11',
      slipDays: -17,
      previousEnd: '2027-03-14',
      endMovedAt: NOW,
    })
    expect(summarizeFinish(goal(earlier), TODAY).headline).toBe(
      'Now projected Mar 11, 2027 (−3 days) · 17 days before target',
    )
    const old = { ...p, endMovedAt: atTime('2026-09-21', '09:00') }
    expect(summarizeFinish(goal(old, null), TODAY).headline).toBe('Projected Mar 23, 2027')
  })
})
