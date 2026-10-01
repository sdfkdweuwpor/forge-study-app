/**
 * `/goals/new?template=wgu-term`: the planner opens with a template already chosen (the onboarding
 * flow's "Plan a WGU term"). Pure: the page reads the query, this decides what the first state is.
 */
import type { ISODate } from '@/db/types'
import { TEMPLATES, type GoalTemplate } from './goalTemplates'
import { applyTemplate, isPristine, type PlannerState } from './plannerDraft'

/** The template a `?template=` value names, or `null` when there is none or it is not one of ours. */
export function templateFromParam(raw: string | undefined): GoalTemplate | null {
  if (raw === undefined) return null
  return TEMPLATES.find((t) => t.id === raw) ?? null
}

/**
 * The planner's first state with the template applied. A draft the person has already started is never
 * replaced: their work wins over a link.
 */
export function withTemplateParam(
  state: PlannerState,
  raw: string | undefined,
  opts: { newKey: () => string; today: ISODate },
): PlannerState {
  const template = templateFromParam(raw)
  if (template === null || !isPristine(state.draft, opts.today)) return state
  return { ...state, draft: applyTemplate(state.draft, template, { ...opts, keepTitle: false }) }
}
