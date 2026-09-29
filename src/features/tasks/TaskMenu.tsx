import {
  CalendarDays,
  CircleCheck,
  Copy,
  Flag,
  FolderInput,
  MoreHorizontal,
  PanelRight,
  Pencil,
  SkipForward,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { Ref, RefCallback } from 'react'
import type { Task } from '@/db/types'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { IconButton } from '@/ui/IconButton'
import { Popover } from '@/ui/Popover'
import { DuePanel, PriorityPanel, ProjectPanel } from './TaskPanels'
import { useTaskActions } from './TaskActions'
import { openTask } from './taskUrls'

export type RowPanel = 'due' | 'priority' | 'move'

interface TaskMenuProps {
  task: Task
  panel: RowPanel | null
  onPanelChange: (panel: RowPanel | null) => void
  /** Starts the inline title editor. */
  onEdit: () => void
  /** Focus stays on the row's `…` button after the menu or a picker closes. */
  className?: string
}

/** Both the menu and the picker it opens anchor to one button, so each needs to see the same element. */
function mergeRefs(...refs: Array<RefCallback<HTMLElement> | Ref<HTMLElement> | undefined>) {
  return (node: HTMLElement | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node)
      else if (ref) (ref as { current: HTMLElement | null }).current = node
    }
  }
}

/**
 * The `…` menu of a task row: Edit, Due date, Priority, Move to…, Duplicate, Delete. Due date, Priority
 * and Move to… open a small picker anchored to the same button.
 */
export function TaskMenu({ task, panel, onPanelChange, onEdit, className }: TaskMenuProps) {
  const actions = useTaskActions()
  const done = task.status === 'done'

  const items: MenuEntry[] = [
    { id: 'open', label: 'Open', icon: <PanelRight />, shortcut: 'enter', onSelect: () => openTask(task.id) },
    { id: 'edit', label: 'Edit title', icon: <Pencil />, shortcut: 'e', onSelect: onEdit },
    { type: 'separator', id: 'sep-edit' },
    { id: 'due', label: 'Due date…', icon: <CalendarDays />, shortcut: 'd', onSelect: () => onPanelChange('due') },
    { id: 'priority', label: 'Priority…', icon: <Flag />, onSelect: () => onPanelChange('priority') },
    { id: 'move', label: 'Move to…', icon: <FolderInput />, onSelect: () => onPanelChange('move') },
    { type: 'separator', id: 'sep-props' },
    {
      id: 'toggle',
      label: done ? 'Mark as not done' : 'Mark as done',
      icon: done ? <Undo2 /> : <CircleCheck />,
      shortcut: 'x',
      onSelect: () => actions.toggleComplete(task),
    },
    ...(done
      ? []
      : [{ id: 'skip', label: 'Skip for today', icon: <SkipForward />, onSelect: () => actions.skip(task) }]),
    { id: 'duplicate', label: 'Duplicate', icon: <Copy />, onSelect: () => void actions.duplicate(task.id) },
    { type: 'separator', id: 'sep-delete' },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 />,
      shortcut: 'mod+backspace',
      danger: true,
      onSelect: () => actions.trash(task),
    },
  ]

  return (
    <Popover
      open={panel !== null}
      onOpenChange={(open) => {
        if (!open) onPanelChange(null)
      }}
      side="bottom"
      align="end"
      label={panel === 'due' ? 'Due date' : panel === 'priority' ? 'Priority' : 'Move to'}
      trigger={(popover) => (
        <Dropdown
          label={`Actions for ${task.title}`}
          side="bottom"
          align="end"
          items={items}
          trigger={(menu) => (
            <IconButton
              {...menu}
              ref={mergeRefs(menu.ref, popover.ref)}
              className={className}
              label="More actions"
              icon={<MoreHorizontal />}
              size="xs"
              tooltipSide="left"
            />
          )}
        />
      )}
    >
      {({ close }) =>
        panel === 'due' ? (
          <DuePanel task={task} close={close} />
        ) : panel === 'priority' ? (
          <PriorityPanel task={task} close={close} />
        ) : panel === 'move' ? (
          <ProjectPanel task={task} close={close} />
        ) : null
      }
    </Popover>
  )
}
