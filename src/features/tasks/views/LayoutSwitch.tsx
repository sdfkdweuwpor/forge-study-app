import { CalendarDays, Columns3, List } from 'lucide-react'
import type { ReactNode } from 'react'
import { PREF_KEYS, readPref, writePref } from '@/lib/localPrefs'
import type { TaskListId } from '@/logic/taskLists'
import {
  parseLayoutPrefs,
  serializeLayoutPrefs,
  type TaskLayout,
} from '@/logic/taskViews'
import { SegmentedControl } from '@/ui/SegmentedControl'

const ICONS: Record<TaskLayout, ReactNode> = {
  list: <List />,
  board: <Columns3 />,
  calendar: <CalendarDays />,
}

const LABELS: Record<TaskLayout, string> = { list: 'List', board: 'Board', calendar: 'Calendar' }

/** The remembered layout of every list on this device (a preference, so it never syncs). */
export function readLayoutPrefs() {
  return parseLayoutPrefs(readPref(PREF_KEYS.tasksLayout))
}

/** Remembers `layout` as the one `list` opens with. */
export function rememberLayout(list: TaskListId, layout: TaskLayout): void {
  writePref(PREF_KEYS.tasksLayout, serializeLayoutPrefs({ ...readLayoutPrefs(), [list]: layout }))
}

interface LayoutSwitchProps {
  value: TaskLayout
  layouts: readonly TaskLayout[]
  onChange: (layout: TaskLayout) => void
}

/** List, Board or Calendar. Hidden where a list has only one (Completed). */
export function LayoutSwitch({ value, layouts, onChange }: LayoutSwitchProps) {
  if (layouts.length < 2) return null
  return (
    <SegmentedControl<TaskLayout>
      label="Layout"
      size="sm"
      value={value}
      onValueChange={onChange}
      options={layouts.map((layout) => ({
        value: layout,
        label: LABELS[layout],
        icon: ICONS[layout],
      }))}
    />
  )
}
