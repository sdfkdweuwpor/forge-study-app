/**
 * The bridge between the mounted `TimerProvider` and code that has no React around it: palette
 * commands, shortcuts and `beginFocus()` (called from the Today screen). The provider registers what
 * only it owns (the live announcement, the toast API, the end dialog and the ticking snapshot); the
 * plain functions in `actions.ts` reach it through here. There is one provider, so one runtime.
 */
import type { ID } from '@/db/types'
import type { ToastApi } from '@/ui/Toast'
import type { TimerSnapshot } from './timerStore'

export interface FocusRuntime {
  /** Says something to screen readers through the polite live region. */
  announce(text: string): void
  toast: ToastApi
  /** Opens the "Done with this task?" dialog for a finished session. */
  openEndDialog(sessionId: ID): void
  snapshot(): TimerSnapshot
  /** Picks the task the next session will be linked to (`null` for none). */
  setDraftTask(taskId: ID | null): void
}

let current: FocusRuntime | null = null

/** Called by the provider on mount. Returns the function that unregisters it. */
export function registerRuntime(runtime: FocusRuntime): () => void {
  current = runtime
  return () => {
    if (current === runtime) current = null
  }
}

/** The mounted provider's runtime, or `null` before it mounts (and in tests). */
export function runtime(): FocusRuntime | null {
  return current
}
