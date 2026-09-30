import { useShortcutHandler } from '@/app/shortcuts'
import { useNowTask } from './nowTask'
import { startFocus } from './startFocus'

/**
 * Binds `shift+s` ("Start focus on the Now task", and the palette's "Start focus") on every page. It
 * is contributed to `global.overlays`, which the shell renders everywhere, and renders nothing. While
 * tasks are still loading, or nothing is actionable, it starts a session with no task.
 */
export function StartFocusHotkey() {
  const now = useNowTask()
  useShortcutHandler('today.startFocus', () => startFocus(now ?? null))
  return null
}
