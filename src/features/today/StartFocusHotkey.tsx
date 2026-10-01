import { useShortcutHandler } from '@/app/shortcuts'
import { readOpenTasks } from '@/db/hooks/useTasks'
import { dayOf } from '@/logic/dates'
import { pickNow } from '@/logic/today'
import { useNowTask } from './nowTask'
import { startFocus } from './startFocus'

/**
 * Binds `shift+s` ("Start focus on the Now task", and the palette's "Start focus") on every page. It
 * is contributed to `global.overlays`, which the shell renders everywhere, and renders nothing. Pressed
 * while its query is still loading (just after a reload, with the Now card already on screen), it reads
 * the Now task once itself; with nothing actionable it starts a session with no task.
 */
export function StartFocusHotkey() {
  const now = useNowTask()
  useShortcutHandler('today.startFocus', () => {
    if (now !== undefined) return startFocus(now)
    void readOpenTasks().then(
      (tasks) => startFocus(pickNow(tasks, { today: dayOf(Date.now()) })),
      () => startFocus(null),
    )
  })
  return null
}
