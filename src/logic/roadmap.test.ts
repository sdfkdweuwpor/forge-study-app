import { describe, expect, it } from 'vitest'
import {
  assignRows,
  dayX,
  layoutLane,
  monthScale,
  spanOf,
  type RoadmapCourse,
  type RoadmapGoal,
} from './roadmap'

const TODAY = '2026-09-29'

describe('monthScale', () => {
  it('starts a month before today and covers the zoom in whole months', () => {
    const s = monthScale(TODAY, 6)
    expect(s.from).toBe('2026-08-01')
    expect(s.to).toBe('2027-02-01')
    expect(s.months.map((m) => m.label)).toEqual(['Aug ’26', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan ’27'])
    expect(s.days).toBe(184)
    expect(s.months.reduce((sum, m) => sum + m.w, 0)).toBeCloseTo(1, 10)
    expect(s.months[1]?.x).toBeCloseTo(31 / 184, 10)
  })

  it('handles 3 and 12 months, and a leap February', () => {
    expect(monthScale(TODAY, 3).months).toHaveLength(3)
    const year = monthScale('2027-12-15', 12)
    expect(year.from).toBe('2027-11-01')
    expect(year.to).toBe('2028-11-01')
    expect(year.days).toBe(366)
    expect(year.months.find((m) => m.key === '2028-02')?.days).toBe(29)
  })
})

describe('spanOf', () => {
  const scale = monthScale(TODAY, 3) // Aug 1 … Nov 1
  it('places a span with both end days inclusive', () => {
    const s = spanOf(scale, '2026-08-01', '2026-08-31')
    expect(s?.x0).toBe(0)
    expect(s?.x1).toBeCloseTo(31 / 92, 10)
    expect(s?.clipStart).toBe(false)
  })

  it('cuts at the edges and drops what is outside', () => {
    expect(spanOf(scale, '2026-07-01', '2026-08-10')).toMatchObject({ x0: 0, clipStart: true })
    expect(spanOf(scale, '2026-10-20', '2026-12-31')).toMatchObject({ x1: 1, clipEnd: true })
    expect(spanOf(scale, '2026-06-01', '2026-07-31')).toBeNull()
    expect(spanOf(scale, '2026-11-01', '2026-11-30')).toBeNull()
    expect(spanOf(scale, '2026-09-10', '2026-09-09')).toBeNull()
  })

  it('dayX can lie outside 0…1', () => {
    expect(dayX(scale, '2026-07-01')).toBeLessThan(0)
    expect(dayX(scale, '2026-12-01')).toBeGreaterThan(1)
  })
})

describe('assignRows', () => {
  it('keeps sequential items on one row and stacks overlapping ones', () => {
    const items = [
      { x0: 0.0, x1: 0.2 },
      { x0: 0.1, x1: 0.3 },
      { x0: 0.25, x1: 0.5 },
      { x0: 0.6, x1: 0.7 },
    ]
    const { rows, rowCount } = assignRows(items)
    expect(rows).toEqual([0, 1, 0, 0])
    expect(rowCount).toBe(2)
  })

  it('treats a hair of space as touching, and works out of order', () => {
    const { rows } = assignRows([
      { x0: 0.5, x1: 0.6 },
      { x0: 0.0, x1: 0.5 },
    ])
    expect(rows).toEqual([1, 0])
    expect(assignRows([]).rowCount).toBe(1)
  })
})

const course = (o: Partial<RoadmapCourse> & { id: string }): RoadmapCourse => ({
  code: null,
  title: o.id,
  status: 'todo',
  start: null,
  end: null,
  hours: 40,
  ...o,
})

function goal(o: Partial<RoadmapGoal> = {}): RoadmapGoal {
  return {
    id: 'g1',
    title: 'B.S. Computer Science',
    icon: '🎓',
    startDate: '2026-08-15',
    targetDate: '2026-11-30',
    projectedEnd: '2026-12-09',
    percent: 20,
    courses: [],
    assessments: [],
    weekly: [],
    ...o,
  }
}

describe('layoutLane', () => {
  const scale = monthScale(TODAY, 6) // Aug 1 … Feb 1

  it('splits the bar at the target and hatches the days after it', () => {
    const lane = layoutLane(goal(), scale)
    expect(lane.finish).toBe('2026-12-09')
    expect(lane.bar?.x1).toBeCloseTo(dayX(scale, '2026-12-01'), 10)
    expect(lane.overrun?.x0).toBeCloseTo(dayX(scale, '2026-12-01'), 10)
    expect(lane.overrun?.x1).toBeCloseTo(dayX(scale, '2026-12-10'), 10)
    expect(lane.target).toBeCloseTo(dayX(scale, '2026-11-30'), 10)
  })

  it('has no overrun when finishing on or before the target', () => {
    const early = layoutLane(goal({ projectedEnd: '2026-11-10' }), scale)
    expect(early.overrun).toBeNull()
    expect(early.bar?.x1).toBeCloseTo(dayX(scale, '2026-11-11'), 10)
    expect(layoutLane(goal({ projectedEnd: '2026-11-30' }), scale).overrun).toBeNull()
  })

  it('falls back to the last course, then to the target, for the finish', () => {
    const c = course({ id: 'c1', start: '2026-09-01', end: '2026-10-15' })
    expect(layoutLane(goal({ projectedEnd: null, courses: [c] }), scale).finish).toBe('2026-10-15')
    expect(layoutLane(goal({ projectedEnd: null }), scale).finish).toBe('2026-11-30')
    const bare = layoutLane(goal({ projectedEnd: null, targetDate: null }), scale)
    expect(bare.finish).toBeNull()
    expect(bare.bar).toBeNull()
    expect(bare.target).toBeNull()
  })

  it('packs overlapping courses into rows and skips undated and outside ones', () => {
    const lane = layoutLane(
      goal({
        courses: [
          course({ id: 'a', code: 'C182', start: '2026-09-01', end: '2026-09-30' }),
          course({ id: 'b', code: 'C779', start: '2026-09-15', end: '2026-10-20' }),
          course({ id: 'c', code: 'D278', start: '2026-10-21', end: '2026-11-15' }),
          course({ id: 'undated' }),
          course({ id: 'old', start: '2026-05-01', end: '2026-06-01' }),
          course({ id: 'far', start: '2027-04-01', end: '2027-05-01' }),
        ],
      }),
      scale,
    )
    expect(lane.courses.map((p) => [p.course.id, p.row])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
    ])
    expect(lane.rowCount).toBe(2)
    expect(lane.before).toBe(1)
    expect(lane.after).toBe(1)
  })

  it('keeps assessment markers and weekly ticks that fall inside the window, centred on their day', () => {
    const lane = layoutLane(
      goal({
        assessments: [
          { id: 'e1', kind: 'exam', title: 'C182 OA', date: '2026-10-10', done: false },
          { id: 'e2', kind: 'project', title: 'D278 PA', date: null, done: false },
          { id: 'e3', kind: 'exam', title: 'Later', date: '2027-06-01', done: false },
        ],
        weekly: [
          { id: 'w1', title: 'Week of Oct 5', date: '2026-10-09' },
          { id: 'w2', title: 'Way back', date: '2026-03-01' },
        ],
      }),
      scale,
    )
    expect(lane.markers.map((m) => m.assessment.id)).toEqual(['e1'])
    expect(lane.markers[0]?.x).toBeCloseTo((dayX(scale, '2026-10-10') * 184 + 0.5) / 184, 10)
    expect(lane.ticks.map((t) => t.milestone.id)).toEqual(['w1'])
  })

  it('omits a target that is outside the window and says which side it is on', () => {
    const after = layoutLane(goal({ targetDate: '2027-09-01', projectedEnd: null }), scale)
    expect(after.target).toBeNull()
    expect(after.targetEdge).toBe('after')
    const before = layoutLane(goal({ targetDate: '2026-05-01', projectedEnd: null }), scale)
    expect(before.targetEdge).toBe('before')
    expect(layoutLane(goal(), scale).targetEdge).toBeNull()
  })
})
