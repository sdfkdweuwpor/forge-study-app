/**
 * Full-screen focus mode (BRIEF §5.2, `f`): only the timer, the current task's name and a subtle
 * progress ring. It asks the browser for real full screen (the Fullscreen API) and falls back to a fixed
 * overlay that covers the window. Esc, `f` or the exit button leave it; leaving full screen through the
 * browser's own Esc closes it too. While open it holds the blocking `fullscreen` shortcut scope, so
 * page keys stay quiet and only the timer's keys work. The controls fade out when the pointer rests;
 * motion is opacity only (`data-motion="opacity"`), so reduced motion keeps it as it is.
 */
import { Minimize2, Pause, Play } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react'
import { useOverlays } from '@/app/providers/OverlayProvider'
import { useShortcutScope } from '@/app/shortcuts'
import { useSettings } from '@/db/hooks/useSettings'
import { useTask } from '@/db/hooks/useTasks'
import { phaseLabel, variantOf } from '@/logic/timer'
import { IconButton } from '@/ui/IconButton'
import { Kbd } from '@/ui/Kbd'
import { primaryAction } from './actions'
import { TimerFace } from './TimerFace'
import { useMode, useTimer } from './useTimer'
import styles from './FullscreenFocus.module.css'

/** How long the pointer may rest before the controls fade out. */
const IDLE_MS = 3000

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

/** The shorter side of the window, in px, kept current on resize. */
function useShortSide(): number {
  return useSyncExternalStore(
    subscribeResize,
    () => Math.min(window.innerWidth, window.innerHeight),
    () => 600,
  )
}

/** False after the pointer or keyboard has been still for `IDLE_MS`; any movement brings it back. */
function useRecentlyActive(): boolean {
  const [active, setActive] = useState(true)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const wake = () => {
      setActive(true)
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => setActive(false), IDLE_MS)
    }
    wake()
    const events = ['pointermove', 'pointerdown', 'keydown', 'touchstart'] as const
    for (const e of events) window.addEventListener(e, wake, { passive: true })
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, wake)
    }
  }, [])
  return active
}

export default function FullscreenFocus() {
  useShortcutScope('fullscreen')
  const overlays = useOverlays()
  const timer = useTimer()
  const settings = useSettings()
  const mode = useMode()
  const short = useShortSide()
  const awake = useRecentlyActive()
  const root = useRef<HTMLDivElement>(null)
  const session = timer.session
  const task = useTask(session?.taskId ?? timer.draftTaskId ?? undefined)

  const close = useEffectEvent(() => overlays.close('focusFullscreen'))

  // Real full screen where the browser allows it. It has to be asked for from a key press or a click,
  // which is how this view is opened; if it is refused, the fixed overlay is already the fallback.
  useEffect(() => {
    let entered = false
    const el = document.documentElement
    if (typeof el.requestFullscreen === 'function' && !document.fullscreenElement) {
      el.requestFullscreen().then(
        () => {
          entered = true
        },
        () => undefined,
      )
    }
    // The browser's own Esc leaves full screen without telling the page's key handler.
    const onChange = () => {
      if (entered && !document.fullscreenElement) close()
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        void document.exitFullscreen().catch(() => undefined)
      }
    }
  }, [])

  // Keyboard focus starts on the view itself and stays inside it (Tab cycles its two buttons).
  useEffect(() => {
    root.current?.focus({ preventScroll: true })
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !root.current) return
      const buttons = [...root.current.querySelectorAll<HTMLElement>('button:not([disabled])')]
      const first = buttons[0]
      const lastButton = buttons[buttons.length - 1]
      if (!first || !lastButton) return
      const at = document.activeElement
      if (e.shiftKey && (at === first || at === root.current)) {
        e.preventDefault()
        lastButton.focus()
      } else if (!e.shiftKey && at === lastButton) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const active = timer.status === 'running' || timer.status === 'paused'
  const paused = timer.status === 'paused'
  const inBreak = session?.kind === 'break'
  const cycle = settings?.timer
  const seconds = active
    ? timer.seconds
    : mode === 'custom'
      ? (cycle?.customMin ?? 50) * 60
      : mode === 'pomodoro'
        ? (cycle?.pomodoroMin ?? 25) * 60
        : 0
  const label = session
    ? paused
      ? 'Paused'
      : phaseLabel(variantOf(session, cycle ?? { longBreakEvery: 4 }))
    : 'Ready'
  const size = Math.round(Math.min(560, Math.max(240, short * 0.72)))

  return (
    <div
      ref={root}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Focus mode"
      tabIndex={-1}
      data-motion="opacity"
      data-awake={awake || undefined}
      data-testid="fullscreen-focus"
    >
      <div className={styles.controls}>
        <IconButton
          label={paused ? 'Resume' : active ? 'Pause' : 'Start'}
          shortcut="space"
          size="md"
          icon={active && !paused ? <Pause /> : <Play />}
          onClick={() => void primaryAction()}
        />
        <IconButton
          label="Exit full screen"
          shortcut="esc"
          size="md"
          icon={<Minimize2 />}
          data-testid="fullscreen-exit"
          onClick={() => overlays.close('focusFullscreen')}
        />
      </div>

      <TimerFace
        seconds={seconds}
        progress={active ? timer.progress : 0}
        label={label}
        tone={inBreak ? 'success' : 'accent'}
        size={size}
        stroke={4}
        subtle
        paused={paused}
        name={inBreak ? 'Break timer' : 'Focus timer'}
      />

      {task ? (
        <p className={styles.task} data-testid="fullscreen-task">
          {task.title}
        </p>
      ) : null}

      <p className={styles.hint} aria-hidden="true">
        <Kbd keys="space" variant="plain" size="sm" /> {paused ? 'resume' : active ? 'pause' : 'start'}
        <span className={styles.dot}>·</span>
        <Kbd keys="esc" variant="plain" size="sm" /> exit
      </p>
    </div>
  )
}
