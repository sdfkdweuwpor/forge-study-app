import { describe, expect, it } from 'vitest'
import { emptyDraft } from './goalDraft'
import { wguTemplate } from './goalTemplates'
import {
  initialWizard,
  isPristine,
  restoreWizard,
  serializeWizard,
  wizardReducer,
  type WizardAction,
  type WizardState,
} from './goalWizard'

const TODAY = '2026-09-29'

function run(actions: WizardAction[], from: WizardState = initialWizard(TODAY)): WizardState {
  return actions.reduce(wizardReducer, from)
}

describe('wizardReducer', () => {
  it('edits the basics', () => {
    const s = run([
      {
        type: 'patch',
        patch: { title: 'WGU', icon: '🎓', coverPreset: 'sage', targetDate: '2027-03-28' },
      },
    ])
    expect(s.draft).toMatchObject({
      title: 'WGU',
      icon: '🎓',
      coverPreset: 'sage',
      targetDate: '2027-03-28',
    })
  })

  it('adds, edits, moves and removes courses, keeping prerequisites tidy', () => {
    let s = run([
      { type: 'addCourse', key: 'a' },
      { type: 'addCourse', key: 'b' },
      { type: 'addCourse', key: 'c' },
      { type: 'patchCourse', key: 'a', patch: { title: 'Intro', hours: '40' } },
      { type: 'togglePrerequisite', key: 'c', prerequisite: 'a' },
      { type: 'togglePrerequisite', key: 'c', prerequisite: 'b' },
    ])
    expect(s.draft.courses.map((c) => c.key)).toEqual(['a', 'b', 'c'])
    expect(s.draft.courses[0]).toMatchObject({ title: 'Intro', hours: '40' })
    expect(s.draft.courses[2]?.prerequisiteKeys).toEqual(['a', 'b'])

    s = wizardReducer(s, { type: 'togglePrerequisite', key: 'c', prerequisite: 'a' })
    expect(s.draft.courses[2]?.prerequisiteKeys).toEqual(['b'])

    // Move c to the top: it can no longer require b.
    s = wizardReducer(s, { type: 'moveCourse', from: 2, to: 0 })
    expect(s.draft.courses.map((c) => c.key)).toEqual(['c', 'a', 'b'])
    expect(s.draft.courses[0]?.prerequisiteKeys).toEqual([])

    s = wizardReducer(s, { type: 'removeCourse', key: 'a' })
    expect(s.draft.courses.map((c) => c.key)).toEqual(['c', 'b'])
  })

  it('sets study hours per weekday', () => {
    const s = run([
      { type: 'setDayMinutes', weekday: 6, minutes: 180 },
      { type: 'setDayMinutes', weekday: 1, minutes: 0 },
    ])
    expect(s.draft.minutesByWeekday).toEqual([0, 0, 60, 60, 60, 60, 180])
  })

  it('adds, edits and removes days off', () => {
    let s = run([
      { type: 'addRange', key: 'r1' },
      {
        type: 'patchRange',
        key: 'r1',
        patch: { start: '2026-12-24', end: '2026-12-26', label: 'Holidays' },
      },
      { type: 'addRange', key: 'r2' },
    ])
    expect(s.draft.daysOff).toEqual([
      { key: 'r1', start: '2026-12-24', end: '2026-12-26', label: 'Holidays' },
      { key: 'r2', start: '', end: '', label: '' },
    ])
    s = wizardReducer(s, { type: 'removeRange', key: 'r1' })
    expect(s.draft.daysOff.map((r) => r.key)).toEqual(['r2'])
  })

  it('the term end follows the start until it is set by hand', () => {
    let s = run([
      { type: 'setTermEnabled', enabled: true },
      { type: 'setTermStart', start: '2026-10-01' },
    ])
    expect(s.draft.term).toMatchObject({ enabled: true, start: '2026-10-01', end: '2027-03-31' })
    s = run(
      [
        { type: 'setTermEnd', end: '2027-03-01' },
        { type: 'setTermStart', start: '2026-11-01' },
      ],
      s,
    )
    expect(s.draft.term.end).toBe('2027-03-01')
    s = wizardReducer(s, { type: 'setTermLabel', label: 'Term 2' })
    expect(s.draft.term.label).toBe('Term 2')
  })

  it('moves between steps, remembers the furthest, and clears the error flag', () => {
    let s = run([{ type: 'attempt' }])
    expect(s.attempted).toBe(true)
    expect(wizardReducer(s, { type: 'attempt' })).toBe(s)
    s = wizardReducer(s, { type: 'go', step: 2 })
    expect(s).toMatchObject({ step: 2, reached: 2, attempted: false })
    s = wizardReducer(s, { type: 'go', step: 0 })
    expect(s).toMatchObject({ step: 0, reached: 2 })
    expect(wizardReducer(s, { type: 'go', step: 9 as never }).step).toBe(3)
    expect(wizardReducer(s, { type: 'go', step: -4 as never }).step).toBe(0)
  })

  it('replace swaps the whole draft and starts on the given step', () => {
    const template = wguTemplate(TODAY, () => 'x')
    const s = wizardReducer(initialWizard(TODAY), { type: 'replace', draft: template, step: 1 })
    expect(s).toMatchObject({ step: 1, reached: 1, attempted: false })
    expect(s.draft.title).toBe('B.S. Computer Science')
  })
})

describe('persistence', () => {
  it('round-trips a draft and its step', () => {
    let n = 0
    const state = wizardReducer(initialWizard(TODAY), {
      type: 'replace',
      draft: wguTemplate(TODAY, () => `k${++n}`),
      step: 2,
    })
    const restored = restoreWizard(serializeWizard(state))
    expect(restored).toEqual({ ...state, reached: 2, attempted: false })
  })

  it('drops anything that is not a valid stored draft', () => {
    expect(restoreWizard(null)).toBeNull()
    expect(restoreWizard('')).toBeNull()
    expect(restoreWizard('{not json')).toBeNull()
    expect(restoreWizard('{"v":2}')).toBeNull()
    const good = JSON.parse(serializeWizard(initialWizard(TODAY))) as Record<string, unknown>
    expect(restoreWizard(JSON.stringify({ ...good, step: 7 }))).toBeNull()
    const draft = good.draft as Record<string, unknown>
    expect(restoreWizard(JSON.stringify({ ...good, draft: { ...draft, kind: 'wat' } }))).toBeNull()
    expect(
      restoreWizard(JSON.stringify({ ...good, draft: { ...draft, minutesByWeekday: [1, 2] } })),
    ).toBeNull()
    expect(
      restoreWizard(JSON.stringify({ ...good, draft: { ...draft, targetDate: 'tomorrow' } })),
    ).toBeNull()
  })
})

describe('isPristine', () => {
  it('is true for a fresh draft and false once anything is filled in', () => {
    const fresh = emptyDraft(TODAY)
    expect(isPristine(fresh, TODAY)).toBe(true)
    expect(isPristine({ ...fresh, title: 'x' }, TODAY)).toBe(false)
    expect(isPristine({ ...fresh, title: '   ' }, TODAY)).toBe(true)
    expect(isPristine({ ...fresh, icon: '🎓' }, TODAY)).toBe(false)
    expect(isPristine({ ...fresh, minutesByWeekday: [0, 90, 60, 60, 60, 60, 0] }, TODAY)).toBe(
      false,
    )
    expect(isPristine({ ...fresh, term: { ...fresh.term, enabled: true } }, TODAY)).toBe(false)
  })
})
