import { useEffect, useState } from 'react'
import { useOverlays } from '@/app/providers/OverlayProvider'
import { useShortcutHandler, useShortcutScope } from '@/app/shortcuts'
import { beginFocus } from '@/features/focus'
import type { Priority, Task } from '@/db/types'
import { useTaskActions } from './TaskActions'

/** Reordering and moving the selection only make sense in a list. */
export interface ListShortcuts {
  /** `j` / `k` and the arrow keys: `1` is down. */
  moveSelection(step: 1 | -1): void
  /** `enter`: open the selected task. */
  open(): void
  /** `alt+↑` / `alt+↓`. */
  reorder(step: 1 | -1): void
  /** `esc`: close the peek or clear the selection. Return whether anything was done. */
  escape(): boolean
}

export interface TaskShortcutOptions {
  /** The task the shortcuts act on: the selected row, or the task page's task. */
  task: Task | null
  list?: ListShortcuts
  /** `#`: take the user to the tags field. */
  editTags(): void
  /** Called just before a task leaves the list (completed or trashed), so selection can move on. */
  beforeLeave?(task: Task): void
}

/**
 * True while nothing interactive has focus (the page body). The Enter shortcut is only live then, so
 * it never swallows Enter on a focused button, link or checkbox, which must keep activating.
 */
function useKeyboardIdle(): boolean {
  const [idle, setIdle] = useState(() => {
    const active = document.activeElement
    return !active || active === document.body
  })
  useEffect(() => {
    const update = () => {
      const active = document.activeElement
      setIdle(!active || active === document.body)
    }
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [])
  return idle
}

/** Turns on the `tasks` scope and binds the tasks shortcuts (see `shortcuts.ts`) to the target task. */
export function useTaskShortcuts({ task, list, editTags, beforeLeave }: TaskShortcutOptions): void {
  // While a palette, dialog, drawer or sheet is open its scope blocks this one (see the shortcut
  // controller), so nothing here has to check for overlays, and `esc` reaches the overlay first.
  useShortcutScope('tasks')
  const actions = useTaskActions()
  const overlays = useOverlays()
  const idle = useKeyboardIdle()
  const active = task !== null

  useShortcutHandler('tasks.new', () => overlays.open('quickAdd'))

  useShortcutHandler('tasks.next', () => list?.moveSelection(1), list !== undefined)
  useShortcutHandler('tasks.nextArrow', () => list?.moveSelection(1), list !== undefined)
  useShortcutHandler('tasks.prev', () => list?.moveSelection(-1), list !== undefined)
  useShortcutHandler('tasks.prevArrow', () => list?.moveSelection(-1), list !== undefined)
  useShortcutHandler('tasks.open', () => list?.open(), idle && list !== undefined && task !== null)
  useShortcutHandler('tasks.moveUp', () => list?.reorder(-1), active && list !== undefined)
  useShortcutHandler('tasks.moveDown', () => list?.reorder(1), active && list !== undefined)
  useShortcutHandler('tasks.escape', () => void list?.escape(), list !== undefined)

  useShortcutHandler(
    'tasks.complete',
    () => {
      if (!task) return
      if (task.status !== 'done') beforeLeave?.(task)
      actions.toggleComplete(task)
    },
    active,
  )
  useShortcutHandler('tasks.edit', () => task && actions.request(task.id, 'edit'), active)
  useShortcutHandler('tasks.dueToday', () => task && void actions.dueToday(task.id), active)
  useShortcutHandler('tasks.dueTomorrow', () => task && void actions.dueTomorrow(task.id), active)
  useShortcutHandler('tasks.dueDate', () => task && actions.request(task.id, 'due'), active)
  useShortcutHandler('tasks.tags', editTags, active)
  useShortcutHandler('tasks.focus', () => task && void beginFocus({ taskId: task.id }), active)
  useShortcutHandler(
    'tasks.trash',
    () => {
      if (!task) return
      beforeLeave?.(task)
      actions.trash(task)
    },
    active,
  )

  const priority = (p: Priority) => () => task && void actions.setPriority(task.id, p)
  useShortcutHandler('tasks.priority0', priority(0), active)
  useShortcutHandler('tasks.priority1', priority(1), active)
  useShortcutHandler('tasks.priority2', priority(2), active)
  useShortcutHandler('tasks.priority3', priority(3), active)
  useShortcutHandler('tasks.priority4', priority(4), active)
}
