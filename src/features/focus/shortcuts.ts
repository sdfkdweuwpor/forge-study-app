import type { ShortcutDef } from '@/app/registry'
import { toggleAmbient } from './sound/actions'

const group = 'Focus'
const fsGroup = 'Full-screen focus'

/**
 * The timer's keys (PLAN §5.2). `f` works anywhere; the rest belong to a scope, so they only exist
 * while it is on the stack: `focus` while the Focus page is open, `fullscreen` (a blocking overlay
 * scope, so page keys stay quiet) while the full-screen view is. The behaviour is bound by
 * `FocusShortcuts`. Esc leaves full screen through the global `app.escape`. The ambient key (`a`) is
 * 4B's, in `sound/commands.ts`.
 */
export const focusShortcuts: ShortcutDef[] = [
  { id: 'focus.fullscreen', keys: 'f', description: 'Full-screen focus mode', group, scope: 'global' },

  { id: 'focus.toggle', keys: 'space', description: 'Start, pause or resume the timer', group, scope: 'focus' },
  { id: 'focus.finish', keys: 'enter', description: 'Finish the session now', group, scope: 'focus' },
  { id: 'focus.skip', keys: 'shift+n', description: 'Skip to the next phase (skip a break)', group, scope: 'focus' },
  { id: 'focus.mode.pomodoro', keys: '1', description: 'Mode: pomodoro', group, scope: 'focus' },
  { id: 'focus.mode.custom', keys: '2', description: 'Mode: custom length', group, scope: 'focus' },
  { id: 'focus.mode.stopwatch', keys: '3', description: 'Mode: stopwatch', group, scope: 'focus' },

  { id: 'focus.fs.toggle', keys: 'space', description: 'Start, pause or resume', group: fsGroup, scope: 'fullscreen' },
  { id: 'focus.fs.finish', keys: 'enter', description: 'Finish the session now', group: fsGroup, scope: 'fullscreen' },
  { id: 'focus.fs.skip', keys: 'shift+n', description: 'Skip to the next phase', group: fsGroup, scope: 'fullscreen' },
  {
    id: 'focus.fs.ambient',
    keys: 'a',
    description: 'Play or pause ambient sound',
    group: fsGroup,
    scope: 'fullscreen',
    run: () => {
      void toggleAmbient()
    },
  },
  { id: 'focus.fs.exit', keys: 'f', description: 'Leave full screen', group: fsGroup, scope: 'fullscreen' },
]
