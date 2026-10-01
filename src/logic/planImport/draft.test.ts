import { describe, expect, it } from 'vitest'
import { toPlanDraft } from './draft'
import { EXAMPLE_JSON } from './example'
import { parsePlan } from './parse'

function plan(text: string) {
  const r = parsePlan(text)
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; '))
  return r.plan
}

describe('toPlanDraft', () => {
  it('turns the example into the planner draft shape', () => {
    const draft = toPlanDraft(plan(EXAMPLE_JSON))
    expect(draft.goal).toEqual({
      title: 'B.S. Computer Science — WGU',
      icon: '🎓',
      targetDate: '2027-03-31',
      term: { start: '2026-10-01', end: '2027-03-31' },
    })
    expect(draft.courses.map((c) => c.code)).toEqual(['C182', 'D278', 'C779'])
    expect(draft.courses[0]).toMatchObject({
      code: 'C182',
      title: 'Introduction to IT',
      cus: 4,
      type: 'OA',
      estimatedHours: 40,
      assessments: [{ title: 'Objective assessment', kind: 'exam' }],
    })
    // Hours become minutes; units given in minutes stay as they are.
    expect(draft.courses[0]?.units.map((u) => u.estimatedMinutes)).toEqual([360, 420, 360, 420, 420, 420])
    expect(draft.courses[1]).toMatchObject({ prerequisites: ['C182'], units: [], assessments: [] })
    expect(draft.courses[2]?.assessments).toEqual([
      { title: 'Web page project', kind: 'project', date: '2026-11-20' },
    ])
  })

  it('omits fields the plan left out instead of writing undefined', () => {
    const draft = toPlanDraft(
      plan(
        '{"forgePlan":1,"goal":{"name":"G"},"courses":[{"code":"c1","name":"N","estimatedHours":5,"units":[{"title":"A"}]}]}',
      ),
    )
    expect(draft).toEqual({
      goal: { title: 'G' },
      courses: [
        { code: 'C1', title: 'N', estimatedHours: 5, units: [{ title: 'A' }], assessments: [] },
      ],
    })
    expect(Object.keys(draft.goal)).toEqual(['title'])
    expect(Object.keys(draft.courses[0] ?? {})).not.toContain('cus')
  })

  it('orders courses by `order`, else by their place in the list, keeping ties stable', () => {
    const draft = toPlanDraft(
      plan(
        `{"forgePlan":1,"goal":{"name":"G"},"courses":[
          {"code":"A","name":"A","estimatedHours":1,"order":3},
          {"code":"B","name":"B","estimatedHours":1},
          {"code":"C","name":"C","estimatedHours":1,"order":"1"},
          {"code":"D","name":"D","estimatedHours":1,"order":1}
        ]}`,
      ),
    )
    // B has no order, so it sits at its list position (1); C and D share order 1 and keep list order.
    expect(draft.courses.map((c) => c.code)).toEqual(['B', 'C', 'D', 'A'])
  })

  it('accepts assessments case-insensitively and rejects unknown kinds with a line', () => {
    const ok = plan(
      '{"forgePlan":1,"goal":{"name":"G"},"courses":[{"code":"A","name":"A","estimatedHours":1,"assessments":[{"title":"Final","kind":"EXAM"}]}]}',
    )
    expect(toPlanDraft(ok).courses[0]?.assessments).toEqual([{ title: 'Final', kind: 'exam' }])

    const bad = parsePlan(
      '{\n"forgePlan":1,\n"goal":{"name":"G"},\n"courses":[{"code":"A","name":"A","estimatedHours":1,\n"assessments":[{"title":"Final","kind":"oral"}]}]}',
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.errors[0]).toMatchObject({
        path: 'courses[0].assessments[0].kind',
        line: 5,
        message: 'courses[0].assessments[0].kind must be one of "exam", "project" or "quiz"',
      })
    }
  })
})
