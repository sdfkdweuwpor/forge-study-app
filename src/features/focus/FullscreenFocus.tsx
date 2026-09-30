/**
 * Full-screen focus mode (BRIEF §5.2, `f`): only the timer, the current task's name and a subtle
 * progress ring. It asks the browser for real full screen (the Fullscreen API) and falls back to a fixed
 * overlay that covers the window. Esc, `f` or the exit button leave it; leaving full screen through the
 * browser's own Esc closes it too. While open it holds the blocking `fullscreen` shortcut scope, so
 * page keys stay quiet and only the timer's keys work. Keyboard focus is held inside (Tab wraps, and a
 * focus that lands outside is pulled back) and handed back to where it was when the view closes. The
 * controls fade out when the pointer rests; motion is opacity only (`data-motion="opacity"`), so reduced
 * motion keeps it as it is. With nothing running it shows what Space will start, as the Focus page does:
 * the break that is up next, or the next round.
 */
import { Minimize2, Pause, Play } from 'lucide-react'
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNow } from '@/app/hooks/useNow'
import { useOverlays } from '@/app/providers/OverlayProvider'
import { useShortcutScope } from '@/app/shortcuts'
import { useSettings } from '@/db/hooks/useSettings'
import { useTask } from '@/db/hooks/useTasks'
import { normalizeCycle, phaseLabel, upNext, variantOf } from '@/logic/timer'
import { IconButton } from '@/ui/IconButton'
import { Kbd } from '@/ui/Kbd'
import { primaryAction } from './actions'
import { useLastFinished } from './queries'
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
    // The view closed before the browser answered: leave full screen when the answer comes.
    let cancelled = false
    const leave = () => {
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        void document.exitFullscreen().catch(() => undefined)
      }
    }
    const el = document.documentElement
    if (typeof el.requestFullscreen === 'function' && !document.fullscreenElement) {
      el.requestFullscreen().then(
        () => {
          entered = true
          if (cancelled) leave()
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
      cancelled = true
      document.removeEventListener('fullscreenchange', onChange)
      leave()
    }
  }, [])

  // Keyboard focus starts on the view itself and stays inside it (Tab cycles its two buttons, and a focus
  // that ends up outside is pulled back), and goes back to where it was when the view closes.
  useEffect(() => {
    const view = root.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    view?.focus({ preventScroll: true })
    const buttons = (): HTMLElement[] =>
      view ? [...view.querySelectorAll<HTMLElement>('button:not([disabled])')] : []
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !view) return
      const first = buttons()[0]
      const lastButton = buttons().at(-1)
      if (!first || !lastButton) {
        e.preventDefault()
        view.focus({ preventScroll: true })
        return
      }
      const at = document.activeElement
      if (!at || !view.contains(at)) {
        e.preventDefault()
        ;(e.shiftKey ? lastButton : first).focus()
      } else if (e.shiftKey && (at === first || at === view)) {
        e.preventDefault()
        lastButton.focus()
      } else if (!e.shiftKey && at === lastButton) {
        e.preventDefault()
        first.focus()
      }
    }
    const onFocusIn = (e: FocusEvent) => {
      if (view && e.target instanceof Node && !view.contains(e.target)) {
        view.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
      // Unless focus has since gone somewhere on purpose, give it back to what had it.
      const at = document.activeElement
      const stillHere = at === null || at === document.body || view?.contains(at) === true
      if (stillHere && previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  const last = useLastFinished()
  const now = useNow('minute')
  const cycle = settings ? normalizeCycle(settings.timer) : null
  const next = useMemo(
    () =>
      settings && last !== undefined ? upNext(last, now, normalizeCycle(settings.timer)) : null,
    [settings, last, now],
  )

  const active = timer.status === 'running' || timer.status === 'paused'
  const paused = timer.status === 'paused'
  const inBreak = session?.kind === 'break'
  // Idle after a counted round: Space starts the break that is up next, so the dial says so.
  const idleBreak = !active && next?.kind === 'break' ? next : null
  const seconds = active
    ? timer.seconds
    : idleBreak
      ? idleBreak.minutes * 60
      : mode === 'custom'
        ? (settings?.timer.customMin ?? 50) * 60
        : mode === 'pomodoro'
          ? (cycle?.pomodoroMin ?? 25) * 60
          : 0
  const label = session
    ? paused
      ? 'Paused'
      : phaseLabel(variantOf(session, cycle ?? { longBreakEvery: 4 }))
    : idleBreak
      ? `${phaseLabel(idleBreak.variant)} next`
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
        tone={inBreak || idleBreak ? 'success' : 'accent'}
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
        <Kbd keys="space" variant="plain" size="sm" />{' '}
        {paused ? 'resume' : active ? 'pause' : 'start'}
        <span className={styles.dot}>·</span>
        <Kbd keys="esc" variant="plain" size="sm" /> exit
      </p>
    </div>
  )
}
