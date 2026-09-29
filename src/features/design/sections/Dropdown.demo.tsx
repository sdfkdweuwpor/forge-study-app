import { useState } from 'react'
import {
  Archive,
  CalendarDays,
  ChevronDown,
  Copy,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import { Button } from '@/ui/Button'
import { Dropdown, MenuPanel, type MenuEntry } from '@/ui/Dropdown'
import { IconButton } from '@/ui/IconButton'
import type { DemoSection } from '../types'
import styles from './Overlays.demo.module.css'

function DropdownDemo() {
  const [chosen, setChosen] = useState<string | null>(null)
  const pick = (label: string) => () => setChosen(label)

  const taskMenu: MenuEntry[] = [
    {
      id: 'edit',
      label: 'Edit task',
      icon: <Pencil />,
      shortcut: 'e',
      onSelect: pick('Edit task'),
    },
    {
      id: 'schedule',
      label: 'Schedule',
      icon: <CalendarDays />,
      shortcut: 's',
      onSelect: pick('Schedule'),
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: <Copy />,
      shortcut: 'mod+d',
      onSelect: pick('Duplicate'),
    },
    { type: 'separator' },
    { id: 'archive', label: 'Archive', icon: <Archive />, onSelect: pick('Archive') },
    { id: 'restore', label: 'Restore from trash', disabled: true, onSelect: pick('Restore') },
    { type: 'separator' },
    {
      id: 'delete',
      label: 'Move to trash',
      icon: <Trash2 />,
      shortcut: 'mod+backspace',
      danger: true,
      onSelect: pick('Move to trash'),
    },
  ]

  const groupedMenu: MenuEntry[] = [
    { type: 'label', label: 'Sort by' },
    { id: 'due', label: 'Due date', onSelect: pick('Due date') },
    { id: 'priority', label: 'Priority', onSelect: pick('Priority') },
    { id: 'course', label: 'Course', onSelect: pick('Course') },
    { type: 'separator' },
    { type: 'label', label: 'Group by' },
    { id: 'none', label: 'Nothing', onSelect: pick('No grouping') },
    { id: 'goal', label: 'Goal', onSelect: pick('Goal') },
  ]

  return (
    <div className={styles.stack}>
      <div className={styles.block}>
        <span className={styles.caption}>
          Arrow keys, Home / End, type to jump, Enter to choose, Esc to close
        </span>
        <div className={styles.row}>
          <Dropdown
            items={taskMenu}
            trigger={(p) => (
              <Button {...p} iconRight={<ChevronDown />}>
                Task options
              </Button>
            )}
          />
          <Dropdown
            items={taskMenu}
            align="end"
            label="More actions"
            trigger={(p) => <IconButton {...p} label="More actions" icon={<MoreHorizontal />} />}
          />
          <Dropdown
            items={groupedMenu}
            trigger={(p) => (
              <Button {...p} variant="ghost" iconRight={<ChevronDown />}>
                View
              </Button>
            )}
          />
          <Dropdown
            items={[]}
            emptyLabel="Nothing to do here"
            trigger={(p) => (
              <Button {...p} variant="ghost">
                Empty menu
              </Button>
            )}
          />
        </div>
        <span className={styles.result} aria-live="polite">
          {chosen ? (
            <>
              Chose <strong>{chosen}</strong>
            </>
          ) : (
            'Nothing chosen yet.'
          )}
        </span>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>
          Items: icon, label, shortcut hint, hover, disabled, danger
        </span>
        <div className={styles.specimens}>
          <MenuPanel entries={taskMenu} label="Task options (specimen)" forceId="schedule" />
          <MenuPanel entries={taskMenu} label="Danger item hovered (specimen)" forceId="delete" />
          <MenuPanel entries={groupedMenu} label="Grouped menu (specimen)" />
        </div>
      </div>
    </div>
  )
}

const section: DemoSection = {
  id: 'dropdown',
  title: 'Dropdown menu',
  group: 'Overlays',
  order: 20,
  description:
    'A menu button with role="menu": icons, shortcut hints, separators, group labels, disabled and danger items. Full keyboard support including typeahead.',
  render: () => <DropdownDemo />,
}

export default section
