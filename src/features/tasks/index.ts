/**
 * Public API of the tasks feature. Other features import from `@/features/tasks` only.
 * `TaskRow` needs a `TaskActionsProvider` around it (the provider owns completion and its Undo toast).
 */
export { TaskActionsProvider, useTaskActions, useTaskEnv, useTaskMotion } from './TaskActions'
export type { TaskActions, TaskEnv, TaskMotion, MotionPhase } from './TaskActions'
export { TaskRow } from './TaskRow'
export type { TaskRowProps } from './TaskRow'
export { TaskList } from './TaskList'
export type { TaskListProps } from './TaskList'
export { openTask, closePeek } from './taskUrls'
export { useTaskShortcuts } from './useTaskShortcuts'
export type { TaskShortcutOptions, ListShortcuts } from './useTaskShortcuts'
export { taskShortcuts } from './shortcuts'
