import { describe, expect, it } from 'vitest'
import { emptyPlannerDraft, initialPlannerState } from './plannerDraft'
import { templateFromParam, withTemplateParam } from './plannerTemplateParam'

const TODAY = '2026-09-29'
const opts = () => {
  let n = 0
  return { today: TODAY, newKey: () => `k${++n}` }
}

describe('templateFromParam', () => {
  it('finds a template by id', () => {
    expect(templateFromParam('wgu-term')?.name).toBe('WGU term')
    expect(templateFromParam('certification')?.id).toBe('certification')
  })

  it('ignores nothing, unknown values and near misses', () => {
    expect(templateFromParam(undefined)).toBeNull()
    expect(templateFromParam('')).toBeNull()
    expect(templateFromParam('wgu')).toBeNull()
    expect(templateFromParam('WGU-TERM')).toBeNull()
  })
})

describe('withTemplateParam', () => {
  it('opens a fresh planner with the template loaded and selected', () => {
    const state = withTemplateParam(initialPlannerState(TODAY), 'wgu-term', opts())
    expect(state.draft.templateId).toBe('wgu-term')
    expect(state.draft.source).toBe('template')
    expect(state.draft.courses.map((c) => c.code)).toContain('C182')
    expect(state.step).toBe(0)
  })

  it('leaves the planner alone without a usable param', () => {
    const start = initialPlannerState(TODAY)
    expect(withTemplateParam(start, undefined, opts())).toBe(start)
    expect(withTemplateParam(start, 'nope', opts())).toBe(start)
  })

  it('never replaces a draft the person already started', () => {
    const started = {
      ...initialPlannerState(TODAY),
      draft: { ...emptyPlannerDraft(TODAY), title: 'Learn Rust in 90 days' },
    }
    expect(withTemplateParam(started, 'wgu-term', opts())).toBe(started)
  })
})
