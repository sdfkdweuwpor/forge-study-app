import { Maximize2, Pause, SkipForward, SlidersHorizontal, Square, Timer } from 'lucide-react'
import type { CommandDef } from '@/app/registry'
import { beginFocus, finishNow, setMode, skipBreak, togglePause } from './actions'
import { runtime } from './runtime'

const active = (): boolean => {
  const status = runtime()?.snapshot().status
  return status === 'running' || status === 'paused'
}
const activeFocus = (): boolean => active() && runtime()?.snapshot().session?.kind === 'focus'
const activeBreak = (): boolean => runtime()?.snapshot().session?.kind === 'break'
const idle = (): boolean => runtime()?.snapshot().status === 'idle'

/**
 * Palette commands for the timer (PLAN §5.2). "Start focus" on the Now task lives with the Today screen
 * (it needs to know the Now task); these are the rest. The numbered starts are single sittings (custom
 * mode, no breaks): 25 or 50 minutes, or "custom" to set the length on the Focus page.
 */
export const focusCommands: CommandDef[] = [
  {
    id: 'command.focus.start25',
    title: 'Start a 25-minute focus session',
    group: 'Focus',
    icon: Timer,
    keywords: ['start', 'begin', 'timer', 'pomodoro', '25'],
    when: idle,
    run: () => void beginFocus({ mode: 'custom', plannedMin: 25 }),
  },
  {
    id: 'command.focus.start50',
    title: 'Start a 50-minute focus session',
    group: 'Focus',
    icon: Timer,
    keywords: ['start', 'begin', 'timer', 'deep work', '50'],
    when: idle,
    run: () => void beginFocus({ mode: 'custom', plannedMin: 50 }),
  },
  {
    id: 'command.focus.startCustom',
    title: 'Start a custom focus session…',
    group: 'Focus',
    icon: SlidersHorizontal,
    keywords: ['start', 'timer', 'length', 'minutes', 'custom'],
    when: idle,
    run: (c) => {
      setMode('custom')
      c.navigate('focus')
    },
  },
  {
    id: 'command.focus.toggle',
    title: 'Pause or resume the timer',
    group: 'Focus',
    icon: Pause,
    keywords: ['pause', 'resume', 'continue', 'timer'],
    shortcutId: 'focus.toggle',
    when: active,
    run: () => void togglePause(),
  },
  {
    id: 'command.focus.stop',
    title: 'Stop the focus session',
    group: 'Focus',
    icon: Square,
    keywords: ['finish', 'end', 'stop', 'done', 'timer'],
    shortcutId: 'focus.finish',
    when: activeFocus,
    run: () => void finishNow(),
  },
  {
    id: 'command.focus.skipBreak',
    title: 'Skip the break',
    group: 'Focus',
    icon: SkipForward,
    keywords: ['break', 'skip', 'next', 'round'],
    shortcutId: 'focus.skip',
    when: activeBreak,
    run: () => void skipBreak(),
  },
  {
    id: 'command.focus.fullscreen',
    title: 'Full-screen focus mode',
    group: 'Focus',
    icon: Maximize2,
    keywords: ['fullscreen', 'full screen', 'zen', 'timer', 'distraction'],
    shortcutId: 'focus.fullscreen',
    run: (c) => c.overlays.open('focusFullscreen'),
  },
]

