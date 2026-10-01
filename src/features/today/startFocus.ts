import { beginFocus } from '@/features/focus'
import type { ID } from '@/db/types'

/**
 * Starts focus on a task. This is the single seam for "Start focus": the Now card button, the `shift+s`
 * shortcut and the palette command call it.
 *
 * It starts a session (the mode picked on the Focus page, pomodoro by default) linked to the task, then
 * opens the Focus page. With a timer already running it starts nothing: it opens the page, linking the
 * task if the running session has none. `null` starts a session with no task (or with the one picked on
 * the Focus page). Errors are recorded and shown there; this never throws.
 */
export function startFocus(task: { id: ID } | null): void {
  void beginFocus(task ? { taskId: task.id } : {})
}
