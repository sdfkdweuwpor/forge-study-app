import { ListChecks, ListPlus, Moon, Sunrise } from 'lucide-react'
import type { CommandDef } from '@/app/registry'
import { openRitualDialog } from './store'

/**
 * Palette commands. The palette closes first, so the dialog is what has the keyboard next. "Add routine…"
 * and "Save today’s tasks as a routine…" are the routine templates (Phase 11i, the small part rituals use).
 */
export const ritualCommands: CommandDef[] = [
  {
    id: 'command.rituals.morning',
    title: 'Morning plan',
    group: 'Review',
    icon: Sunrise,
    shortcutId: 'rituals.morning',
    keywords: ['top 3', 'plan my day', 'daily goal', 'ritual', 'start of day', 'priorities'],
    run: (c) => {
      c.overlays.close('palette')
      openRitualDialog('morning')
    },
  },
  {
    id: 'command.rituals.evening',
    title: 'Evening shutdown',
    group: 'Review',
    icon: Moon,
    shortcutId: 'rituals.evening',
    keywords: ['wrap up', 'end of day', 'reflection', 'move to tomorrow', 'ritual', 'shut down'],
    run: (c) => {
      c.overlays.close('palette')
      openRitualDialog('evening')
    },
  },
  {
    id: 'command.rituals.addRoutine',
    title: 'Add routine…',
    group: 'Create',
    icon: ListPlus,
    keywords: ['template', 'study day', 'weekly reset', 'tasks', 'repeat', 'set of tasks'],
    run: (c) => {
      c.overlays.close('palette')
      openRitualDialog('routine')
    },
  },
  {
    id: 'command.rituals.saveRoutine',
    title: 'Save today’s tasks as a routine…',
    group: 'Create',
    icon: ListChecks,
    keywords: ['template', 'routine', 'save', 'repeat', 'set of tasks'],
    run: (c) => {
      c.overlays.close('palette')
      openRitualDialog('saveRoutine')
    },
  },
]
