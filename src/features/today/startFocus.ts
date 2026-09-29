import { navigate } from '@/app/router'
import type { ID } from '@/db/types'

/**
 * Starts focus on a task. This is the single seam for "Start focus": the Now card button, and any
 * shortcut or command, call it.
 *
 * Phase 3: it opens the Focus route with `?task=<id>` (no `task` when there is none). The Focus page
 * reads that parameter to pre-select the task. Phase 4 replaces the body: start the session for the
 * task, then navigate to `/focus`, and the Today screen keeps working unchanged.
 */
export function startFocus(task: { id: ID } | null): void {
  navigate('focus', undefined, task ? { query: { task: task.id } } : undefined)
}
