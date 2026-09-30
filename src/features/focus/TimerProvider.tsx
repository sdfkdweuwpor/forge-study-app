/**
 * Runs the timer for the whole app (registered through the feature manifest's `providers`), so it
 * keeps going on every page. It owns:
 *
 * - the ticking view (`TimerStore`), fed by the active session row and a Web Worker heartbeat;
 * - the end of a phase: when the tick finds the time up it settles the session (`reconcileRunning`),
 *   then chimes, notifies, queues the "Done with this task?" dialog and starts the next phase if
 *   settings say so. On load it does the same for a phase that ended while the tab was closed;
 * - a polite `aria-live` region: phase changes and a few countdown marks, never every second;
 * - the ambient sound around running focus sessions.
 *
 * Nothing here keeps time: every tick recomputes from the session's timestamps.
 */
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { recordError } from '@/app/reportError'
import { useActiveSession } from '@/db/hooks/useActiveSession'
import { useSettings } from '@/db/hooks/useSettings'
import { reconcileRunning } from '@/db/repos/sessions'
import type { ID } from '@/db/types'
import { PREF_KEYS, readPref, removePref, writePref } from '@/lib/localPrefs'
import { MS_PER_MINUTE, clockOf, crossedMark, isDue } from '@/logic/timer'
import { useToast } from '@/ui/Toast'
import { LATE_MS, handlePhaseEnd } from './phaseEnd'
import { getSessionById } from './queries'
import { registerRuntime } from './runtime'
import { startTicker } from './ticker'
import { TimerStore } from './timerStore'
import { TimerContext } from './useTimer'

/** Loaded when the first "Done with this task?" is due: it pulls in the tasks repo and the modal. */
const EndDialog = lazy(() => import('./EndDialog'))

/** An unanswered "Done with this task?" is asked again after a refresh, but not days later. */
const PENDING_END_MAX_MS = 12 * 60 * 60 * 1000

interface EndState {
  id: ID | null
  open: boolean
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [store] = useState(() => new TimerStore())
  const session = useActiveSession()
  const settings = useSettings()
  const [announcement, setAnnouncement] = useState('')
  const [end, setEnd] = useState<EndState>({ id: null, open: false })
  /** The session whose end is being settled, so a slow write is not started twice by the next tick. */
  const ending = useRef<ID | null>(null)

  const announce = useCallback((text: string) => {
    // The same words twice in a row would not be read again, so vary them invisibly.
    setAnnouncement((prev) => (prev === text ? `${text}\u00a0` : text))
  }, [])

  const openEnd = useCallback((id: ID) => {
    writePref(PREF_KEYS.focusPendingEnd, id)
    setEnd({ id, open: true })
  }, [])
  const closeEnd = useCallback(() => {
    removePref(PREF_KEYS.focusPendingEnd)
    setEnd((prev) => ({ ...prev, open: false }))
  }, [])

  // The runtime lets plain functions (palette commands, shortcuts, Start focus on Today) reach in.
  useEffect(
    () =>
      registerRuntime({
        announce,
        toast,
        openEndDialog: openEnd,
        snapshot: store.getSnapshot,
        setDraftTask: (taskId) => store.setDraftTask(taskId),
      }),
    [announce, toast, openEnd, store],
  )

  // The active session row is the truth; the store is its ticking view.
  useEffect(() => {
    store.setSession(session, Date.now())
  }, [store, session])

  /** Settles a running session whose time is up (idempotent, and safe with several tabs open). */
  const finishDue = useCallback(async () => {
    const now = Date.now()
    try {
      const result = await reconcileRunning(now)
      if (result) {
        const late = now - (result.session.endedAt ?? now) > LATE_MS
        await handlePhaseEnd(result, late)
      }
    } catch (error) {
      ending.current = null
      recordError(error, 'finish the phase')
    }
  }, [])

  const beat = useCallback(() => {
    const now = Date.now()
    const before = store.getSnapshot()
    store.tick(now)
    const after = store.getSnapshot()
    const s = after.session
    if (s === null || s.status !== 'running') return

    if (before.session?.id === s.id && s.plannedMinutes !== null) {
      const mark = crossedMark(before.seconds, after.seconds, s.plannedMinutes * MS_PER_MINUTE)
      if (mark !== null) announce(`${mark} ${mark === 1 ? 'minute' : 'minutes'} left.`)
    }
    if (isDue(clockOf(s), now) && ending.current !== s.id) {
      ending.current = s.id
      void finishDue()
    }
  }, [store, announce, finishDue])

  // The heartbeat runs only while something is counting.
  const running = session?.status === 'running'
  useEffect(() => {
    if (!running) return undefined
    const ticker = startTicker(beat)
    return () => ticker.stop()
  }, [running, beat])

  // On load, and whenever the tab comes back, catch up with a phase that ended in the meantime.
  useEffect(() => {
    void finishDue()
    const wake = () => {
      if (document.visibilityState === 'visible') {
        beat()
        void finishDue()
      }
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
  }, [beat, finishDue])

  // A "Done with this task?" that was not answered before a refresh is asked again.
  useEffect(() => {
    const id = readPref(PREF_KEYS.focusPendingEnd)
    if (!id) return
    void getSessionById(id).then(
      (s) => {
        const fresh = s?.endedAt != null && Date.now() - s.endedAt < PENDING_END_MAX_MS
        if (s && fresh && s.kind === 'focus' && s.status === 'completed') openEnd(id)
        else removePref(PREF_KEYS.focusPendingEnd)
      },
      () => removePref(PREF_KEYS.focusPendingEnd),
    )
  }, [openEnd])

  // Ambient sound: on while a focus session runs (when settings ask for it), off when it pauses or ends.
  const ambient = settings?.sound.ambient ?? 'none'
  const ambientVolume = settings?.sound.ambientVolume ?? 0
  const wantAmbient =
    settings !== undefined &&
    settings.sound.enabled &&
    ambient !== 'none' &&
    session?.kind === 'focus' &&
    session.status === 'running'
  const bedVolume = useEffectEvent(() => ambientVolume)
  // The audio code is loaded when it is first needed, not with the app.
  useEffect(() => {
    void import('@/lib/audio').then((audio) => audio.armAudioUnlock())
  }, [])
  useEffect(() => {
    if (!wantAmbient) return undefined
    let cancelled = false
    void import('@/lib/audio').then((audio) => {
      if (!cancelled) void audio.startAmbient(ambient, bedVolume())
    })
    return () => {
      cancelled = true
      void import('@/lib/audio').then((audio) => audio.stopAmbient())
    }
  }, [wantAmbient, ambient])
  useEffect(() => {
    if (wantAmbient) void import('@/lib/audio').then((audio) => audio.setAmbientVolume(ambientVolume))
  }, [wantAmbient, ambientVolume])

  return (
    <TimerContext.Provider value={store}>
      {children}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="timer-announcer"
      >
        {announcement}
      </div>
      {end.id !== null ? (
        <Suspense fallback={null}>
          <EndDialog key={end.id} sessionId={end.id} open={end.open} onClose={closeEnd} />
        </Suspense>
      ) : null}
    </TimerContext.Provider>
  )
}
