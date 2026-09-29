/**
 * Binds the timer's keyboard shortcuts to what they do (`slots: global.overlays`, so it is mounted on
 * every page and renders nothing). The keys only work in their scope (`focus` on the Focus page,
 * `fullscreen` in the full-screen view; `f` works anywhere), but the handlers are always bound, so
 * palette commands can reuse them. Space and Enter step aside while a button, link or field has
 * keyboard focus (see `useKeyboardIdle`).
 */
import { useOverlays } from '@/app/providers/OverlayProvider'
import { useShortcutHandler } from '@/app/shortcuts'
import { finishNow, primaryAction, setMode, skipPhase } from './actions'
import { useKeyboardIdle } from './useKeyboardIdle'
import { useTimer } from './useTimer'

export function FocusShortcuts() {
  const overlays = useOverlays()
  const timer = useTimer()
  const idle = useKeyboardIdle()

  const active = timer.status === 'running' || timer.status === 'paused'
  const canPickMode = timer.status === 'idle'

  const toggle = () => void primaryAction()
  const finish = () => void finishNow()
  const skip = () => void skipPhase()

  // `f` opens the full-screen view from anywhere; inside it, `f` leaves again.
  useShortcutHandler('focus.fullscreen', () => overlays.open('focusFullscreen'))
  useShortcutHandler('focus.fs.exit', () => overlays.close('focusFullscreen'))

  useShortcutHandler('focus.toggle', toggle, idle)
  useShortcutHandler('focus.finish', finish, idle && active)
  useShortcutHandler('focus.skip', skip, active || timer.status === 'idle')
  useShortcutHandler('focus.mode.pomodoro', () => setMode('pomodoro'), canPickMode)
  useShortcutHandler('focus.mode.custom', () => setMode('custom'), canPickMode)
  useShortcutHandler('focus.mode.stopwatch', () => setMode('stopwatch'), canPickMode)

  useShortcutHandler('focus.fs.toggle', toggle, idle)
  useShortcutHandler('focus.fs.finish', finish, idle && active)
  useShortcutHandler('focus.fs.skip', skip, active || timer.status === 'idle')

  return null
}
