import type { ShortcutDef } from '@/app/registry'

const group = 'Goals'

/**
 * The goals keyboard map (PLAN §5.2). `n` starts a goal on the goals list; `c` adds a course on a goal
 * page; `n` adds a unit on a course page (a different scope, so the same key means "new" in each place).
 * They are bound to behaviour by the pages that own them, and only exist while their scope is on the
 * stack. Rebalance (`shift+r`) and import (`i`) belong to the integration step.
 */
export const goalShortcuts: ShortcutDef[] = [
  { id: 'goals.new', keys: 'n', description: 'New goal', group, scope: 'goal' },
  { id: 'goals.addCourse', keys: 'c', description: 'Add a course', group, scope: 'goal' },
  {
    id: 'goals.trash',
    keys: 'mod+backspace',
    description: 'Move the goal to the trash',
    group,
    scope: 'goal',
  },
  { id: 'course.newUnit', keys: 'n', description: 'Add a unit', group, scope: 'course' },
  {
    id: 'course.complete',
    keys: 'shift+d',
    description: 'Mark the course complete (or not)',
    group,
    scope: 'course',
  },
  {
    id: 'course.trash',
    keys: 'mod+backspace',
    description: 'Move the course to the trash',
    group,
    scope: 'course',
  },
]
