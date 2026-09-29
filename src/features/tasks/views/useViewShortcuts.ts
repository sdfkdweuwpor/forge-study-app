import { useOpenOverlays } from '@/app/providers/OverlayProvider'
import { useShortcutHandler, useShortcutScope } from '@/app/shortcuts'
import type { TaskLayout } from '@/logic/taskViews'

export interface ViewShortcutOptions {
  layout: TaskLayout
  /** The layouts the current list offers. */
  layouts: readonly TaskLayout[]
  setLayout: (layout: TaskLayout) => void
  /** `v s`: open the Save view popover (or say there is nothing to save yet). */
  saveView: () => void
  /** A task is selected, so the keyboard alternatives to dragging have something to move. */
  hasSelection: boolean
  board: { move: (step: -1 | 1) => void }
  calendar: {
    shift: (direction: -1 | 1) => void
    today: () => void
    nudge: (change: { days?: number; minutes?: number }) => void
  }
}

/** Binds the layout keys, the board's column keys and the calendar's week and nudge keys (see `viewShortcuts`). */
export function useViewShortcuts({
  layout,
  layouts,
  setLayout,
  saveView,
  hasSelection,
  board,
  calendar,
}: ViewShortcutOptions): void {
  const onCalendar = layout === 'calendar'
  useShortcutScope('calendar', onCalendar)
  // A palette, quick add or sheet on top owns the keyboard.
  const free = useOpenOverlays().length === 0

  useShortcutHandler('tasks.layoutList', () => setLayout('list'), free && layouts.includes('list'))
  useShortcutHandler('tasks.layoutBoard', () => setLayout('board'), free && layouts.includes('board'))
  useShortcutHandler(
    'tasks.layoutCalendar',
    () => setLayout('calendar'),
    free && layouts.includes('calendar'),
  )
  useShortcutHandler('tasks.saveView', saveView, free)

  const onBoard = layout === 'board' && free && hasSelection
  useShortcutHandler('board.moveLeft', () => board.move(-1), onBoard)
  useShortcutHandler('board.moveRight', () => board.move(1), onBoard)

  const calendarFree = onCalendar && free
  useShortcutHandler('calendar.prev', () => calendar.shift(-1), calendarFree)
  useShortcutHandler('calendar.next', () => calendar.shift(1), calendarFree)
  useShortcutHandler('calendar.today', calendar.today, calendarFree)
  const nudging = calendarFree && hasSelection
  useShortcutHandler('calendar.dayBack', () => calendar.nudge({ days: -1 }), nudging)
  useShortcutHandler('calendar.dayForward', () => calendar.nudge({ days: 1 }), nudging)
  useShortcutHandler('calendar.timeEarlier', () => calendar.nudge({ minutes: -15 }), nudging)
  useShortcutHandler('calendar.timeLater', () => calendar.nudge({ minutes: 15 }), nudging)
}
