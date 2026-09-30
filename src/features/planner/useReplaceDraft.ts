import { useCallback, useEffect, useRef, type Dispatch } from 'react'
import type { ISODate } from '@/db/types'
import {
  isPristine,
  type PlannerAction,
  type PlannerDraft,
  type PlannerStep,
} from '@/logic/plannerDraft'
import { useToast } from '@/ui/Toast'

/** Replaces the draft, with an Undo toast when there was something to lose. */
export type ReplaceDraft = (
  next: PlannerDraft,
  message: string,
  description?: string,
  to?: PlannerStep,
) => void

/**
 * The one way the planner replaces a draft that may hold work (a template, a re-read of the text, a PDF,
 * Claude's plan): the draft it replaces is read from a ref, so a replacement that starts after an `await`
 * (a PDF takes seconds) undoes to what is on screen then, not to what was there when it began. `latest`
 * gives the same current draft to callers that must build the next one after an `await`.
 */
export function useReplaceDraft(
  draft: PlannerDraft,
  dispatch: Dispatch<PlannerAction>,
  today: ISODate,
): { replace: ReplaceDraft; latest: () => PlannerDraft } {
  const toast = useToast()
  const ref = useRef(draft)
  useEffect(() => {
    ref.current = draft
  })
  const latest = useCallback(() => ref.current, [])
  const replace = useCallback<ReplaceDraft>(
    (next, message, description, to) => {
      const previous = ref.current
      // Later replacements in the same tick (a re-read, then Continue) undo to this one's result.
      ref.current = next
      dispatch({ type: 'replaceDraft', draft: next, ...(to !== undefined ? { step: to } : {}) })
      if (!isPristine(previous, today) && previous.courses.length > 0) {
        toast.show({
          title: message,
          ...(description ? { description } : {}),
          undo: () => dispatch({ type: 'replaceDraft', draft: previous }),
        })
      }
    },
    [dispatch, toast, today],
  )
  return { replace, latest }
}
