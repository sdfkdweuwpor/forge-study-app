import { describe, expect, it } from 'vitest'
import { timelineModel } from './plannerTimeline'

describe('timelineModel', () => {
  const input = {
    start: '2026-10-01',
    courses: [
      { id: 'a', label: 'C182', start: '2026-10-01', end: '2026-11-15' },
      { id: 'b', label: 'D278', start: '2026-11-16', end: '2026-12-31' },
    ],
    assessments: [
      { id: 'x', courseId: 'a', title: 'OA', kind: 'exam' as const, date: '2026-11-16' },
    ],
    target: '2027-01-15',
    projectedEnd: '2026-12-31',
  }

  it('places bars, marks, target and finish along one axis', () => {
    const m = timelineModel(input)
    expect(m).not.toBeNull()
    if (!m) return
    expect(m.bars[0]?.x0).toBe(0)
    expect((m.bars[0]?.x1 ?? 0) < (m.bars[1]?.x0 ?? 0)).toBe(true)
    expect(m.bars[0]?.marks[0]?.x).toBeGreaterThan(m.bars[0]?.x1 ?? 1)
    expect(m.finish).toBeLessThan(m.target ?? 0)
    expect(m.target).toBeLessThanOrEqual(1)
    expect(m.ticks.map((t) => t.label)).toEqual(
      ['Nov', 'Dec', 'Jan', 'Feb'].slice(0, m.ticks.length),
    )
    expect(m.ticks.find((t) => t.label === 'Jan')?.major).toBe(true)
  })

  it('has nothing to draw without courses', () => {
    expect(timelineModel({ ...input, courses: [] })).toBeNull()
  })

  it('handles no target and a one-day course', () => {
    const m = timelineModel({
      ...input,
      target: null,
      courses: [{ id: 'a', label: 'X', start: '2026-10-05', end: '2026-10-05' }],
      assessments: [],
    })
    expect(m?.target).toBeNull()
    expect((m?.bars[0]?.x1 ?? 0) > (m?.bars[0]?.x0 ?? 1)).toBe(true)
  })
})
