import type { ShortcutDef } from '@/app/registry'

/**
 * Layout, board and calendar keys (PLAN §5.2). The `calendar` scope sits on top of `tasks` while the
 * calendar is showing, so its `t`, `←`/`→` and Alt+arrows win there, and the tasks keys they share
 * (`t` = due today, Alt+↑/↓ = reorder) keep working in the other layouts.
 */
export const viewShortcuts: ShortcutDef[] = [
  { id: 'tasks.layoutList', keys: 'v l', description: 'Show as a list', group: 'Tasks', scope: 'tasks' },
  { id: 'tasks.layoutBoard', keys: 'v b', description: 'Show as a board', group: 'Tasks', scope: 'tasks' },
  {
    id: 'tasks.layoutCalendar',
    keys: 'v c',
    description: 'Show as a calendar',
    group: 'Tasks',
    scope: 'tasks',
  },
  { id: 'tasks.saveView', keys: 'v s', description: 'Save this view', group: 'Tasks', scope: 'tasks' },
  {
    id: 'board.moveLeft',
    keys: 'alt+left',
    description: 'Move the card to the previous column',
    group: 'Board',
    scope: 'tasks',
  },
  {
    id: 'board.moveRight',
    keys: 'alt+right',
    description: 'Move the card to the next column',
    group: 'Board',
    scope: 'tasks',
  },
  { id: 'calendar.prev', keys: 'left', description: 'Previous week', group: 'Calendar', scope: 'calendar' },
  { id: 'calendar.next', keys: 'right', description: 'Next week', group: 'Calendar', scope: 'calendar' },
  { id: 'calendar.today', keys: 't', description: 'Jump to this week', group: 'Calendar', scope: 'calendar' },
  {
    id: 'calendar.dayBack',
    keys: 'alt+left',
    description: 'Move the task a day earlier',
    group: 'Calendar',
    scope: 'calendar',
  },
  {
    id: 'calendar.dayForward',
    keys: 'alt+right',
    description: 'Move the task a day later',
    group: 'Calendar',
    scope: 'calendar',
  },
  {
    id: 'calendar.timeEarlier',
    keys: 'alt+up',
    description: 'Move the task 15 minutes earlier',
    group: 'Calendar',
    scope: 'calendar',
  },
  {
    id: 'calendar.timeLater',
    keys: 'alt+down',
    description: 'Move the task 15 minutes later',
    group: 'Calendar',
    scope: 'calendar',
  },
]
