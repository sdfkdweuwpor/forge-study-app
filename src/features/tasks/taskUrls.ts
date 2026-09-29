import { navigate, setQuery } from '@/app/router'
import type { ID } from '@/db/types'

/** The peek panel needs room beside the list; below this the task opens as a page (BRIEF §3.8). */
export const PEEK_MEDIA_QUERY = '(min-width: 640px)'

export function peekFits(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(PEEK_MEDIA_QUERY).matches
}

/** Opens a task: in the peek panel when the list is on screen and there is room, else on its own page. */
export function openTask(id: ID): void {
  const onTaskList = window.location.pathname.startsWith('/tasks')
  if (onTaskList && peekFits()) setQuery({ peek: id })
  else navigate('task', { taskId: id })
}

/** The peek is transient view state, so opening and closing it replace the history entry (Back leaves the page). */
export function closePeek(): void {
  setQuery({ peek: undefined })
}
