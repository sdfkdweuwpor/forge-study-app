import type { ShortcutDef } from '@/app/registry'

const group = 'Tasks'
const scope = 'tasks'

/**
 * The tasks keyboard map (PLAN §5.2). They act on the selected row of a list, or on the open task
 * page, and are bound to behaviour by `useTaskShortcuts`. They only exist while the `tasks` scope is
 * on the stack, so they never clash with `focus`'s single keys.
 */
export const taskShortcuts: ShortcutDef[] = [
  { id: 'tasks.next', keys: 'j', description: 'Select the next task', group, scope },
  { id: 'tasks.nextArrow', keys: 'down', description: 'Select the next task', group, scope },
  { id: 'tasks.prev', keys: 'k', description: 'Select the previous task', group, scope },
  { id: 'tasks.prevArrow', keys: 'up', description: 'Select the previous task', group, scope },
  { id: 'tasks.complete', keys: 'x', description: 'Complete or reopen the task', group, scope },
  { id: 'tasks.open', keys: 'enter', description: 'Open the task', group, scope },
  { id: 'tasks.edit', keys: 'e', description: 'Edit the task title', group, scope },
  { id: 'tasks.new', keys: 'n', description: 'New task', group, scope },
  { id: 'tasks.priority0', keys: '0', description: 'Priority: none', group, scope },
  { id: 'tasks.priority1', keys: '1', description: 'Priority: low', group, scope },
  { id: 'tasks.priority2', keys: '2', description: 'Priority: medium', group, scope },
  { id: 'tasks.priority3', keys: '3', description: 'Priority: high', group, scope },
  { id: 'tasks.priority4', keys: '4', description: 'Priority: urgent', group, scope },
  { id: 'tasks.dueToday', keys: 't', description: 'Due today', group, scope },
  { id: 'tasks.dueTomorrow', keys: 'm', description: 'Due tomorrow', group, scope },
  { id: 'tasks.dueDate', keys: 'd', description: 'Pick a due date', group, scope },
  { id: 'tasks.tags', keys: '#', description: 'Edit tags', group, scope },
  { id: 'tasks.focus', keys: 's', description: 'Start focus on the task', group, scope },
  { id: 'tasks.moveUp', keys: 'alt+up', description: 'Move the task up', group, scope },
  { id: 'tasks.moveDown', keys: 'alt+down', description: 'Move the task down', group, scope },
  {
    id: 'tasks.trash',
    keys: 'mod+backspace',
    description: 'Move the task to the trash',
    group,
    scope,
  },
  {
    id: 'tasks.escape',
    keys: 'esc',
    description: 'Close the task panel or clear the selection',
    group,
    scope,
  },
]
