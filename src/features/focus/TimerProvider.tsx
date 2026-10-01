/**
 * Runs the timer for the whole app (registered through the feature manifest's `providers`), so it
 * keeps going on every page. It owns:
 *
 * - the ticking view (`TimerStore`), fed by the active session row and a Web Worker heartbeat;
 * - the end of a phase: when the tick finds the time up it settles the session (`reconcileRunning`),
 *   then chimes, notifies, queues the "Done with this task?" dialog and starts the next phase if
 *   settings say so. On load it does the same for a phase that ended while the tab was closed;
 * - the "Done with this task?" dialogs: they queue (a new one never replaces one still on screen), the
 *   one being asked is remembered in `forge:focus:pending-end` so a refresh asks again, and every open
 *   tab shows it (only one tab wins the settle, the others hear about it through that key), answering
 *   in one closes it in the others;
 * - a polite `aria-live` region: phase changes and a few countdown marks, never every second;
 * - the ambient sound around running focus sessions, played by one elected tab (`ambientElection`).
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
import { PREF_KEYS, readPref, removePref, subscribePrefs, writePref } from '@/lib/localPrefs'
import { MS_PER_MINUTE, clockOf, crossedMark, isDue } from '@/logic/timer'
import { useToast } from '@/ui/Toast'
import { browserElection, electAmbientOwner } from './ambientElection'
import { answered, ask, withdraw } from './askQueue'
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
  /** The session whose question is on screen (kept, closed, while the dialog fades out). */
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
  /** Sessions whose "Done with this task?" is unanswered in this tab; the first one is on screen. */
  const asked = useRef<readonly ID[]>([])
  /** The session whose end is being settled, so a slow write is not started twice by the next tick. */
  const ending = useRef<ID | null>(null)
  /** Whether settings say sounds are on, for code that has to decide without waiting for a render. */
  const soundOn = useRef(false)
  useEffect(() => {
    soundOn.current = settings?.sound.enabled ?? false
  }, [settings?.sound.enabled])

  const announce = useCallback((text: string) => {
    // The same words twice in a row would not be read again, so vary them invisibly.
    setAnnouncement((prev) => (prev === text ? `${text}\u00a0` : text))
  }, [])

  /** Puts a question in line. The first in line is shown and remembered across a refresh. */
  const openEnd = useCallback((id: ID) => {
    const line = ask(asked.current, id)
    if (line === asked.current) return
    asked.current = line
    if (line.length === 1) {
      writePref(PREF_KEYS.focusPendingEnd, id)
      setEnd({ id, open: true })
    }
  }, [])
  /** The question on screen was answered or dismissed (here, or in another tab): on to the next. */
  const closeEnd = useCallback((id: ID) => {
    const line = answered(asked.current, id)
    if (line === asked.current) return
    asked.current = line
    const next = line[0]
    if (next === undefined) {
      removePref(PREF_KEYS.focusPendingEnd)
      setEnd((prev) => ({ ...prev, open: false }))
    } else {
      writePref(PREF_KEYS.focusPendingEnd, next)
      setEnd({ id: next, open: true })
    }
  }, [])
  /** A finish was taken back: its question is withdrawn, wherever it stands in line. */
  const dropEnd = useCallback(
    (id: ID) => {
      if (asked.current[0] === id) closeEnd(id)
      else asked.current = withdraw(asked.current, id)
    },
    [closeEnd],
  )

  // The runtime lets plain functions (palette commands, shortcuts, Start focus on Today) reach in.
  useEffect(
    () =>
      registerRuntime({
        announce,
        toast,
        openEndDialog: openEnd,
        closeEndDialog: dropEnd,
        soundEnabled: () => soundOn.current,
        snapshot: store.getSnapshot,
        setDraftTask: (taskId) => store.setDraftTask(taskId),
      }),
    [announce, toast, openEnd, dropEnd, store],
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

  // A "Done with this task?" that is owed is asked here too: after a refresh, when another tab settled the
  // session (only the tab that wins the race hears of it first), and when this tab comes to the front.
  const askPending = useCallback(() => {
    const id = readPref(PREF_KEYS.focusPendingEnd)
    if (id === null || asked.current.includes(id)) return
    const forget = () => {
      if (readPref(PREF_KEYS.focusPendingEnd) === id) removePref(PREF_KEYS.focusPendingEnd)
    }
    void getSessionById(id).then((s) => {
      const fresh = s?.endedAt != null && Date.now() - s.endedAt < PENDING_END_MAX_MS
      if (s && fresh && s.kind === 'focus' && s.status === 'completed') openEnd(id)
      else forget()
    }, forget)
  }, [openEnd])
  useEffect(() => {
    askPending()
    const wake = () => {
      if (document.visibilityState === 'visible') askPending()
    }
    document.addEventListener('visibilitychange', wake)
    // The key changed here or in another tab: a question was raised (ask it if this tab is in front) or
    // answered (stop asking it).
    const off = subscribePrefs(() => {
      const id = readPref(PREF_KEYS.focusPendingEnd)
      const showing = asked.current[0]
      if (id === null && showing !== undefined) closeEnd(showing)
      else if (id !== null && document.visibilityState === 'visible') askPending()
    })
    return () => {
      document.removeEventListener('visibilitychange', wake)
      off()
    }
  }, [askPending, closeEnd])

  // Ambient sound: on while a focus session runs (when settings ask for it), off when it pauses or ends.
  const soundEnabled = settings?.sound.enabled ?? false
  const ambient = settings?.sound.ambient ?? 'none'
  const ambientVolume = settings?.sound.ambientVolume ?? 0
  const wantAmbient =
    soundEnabled &&
    ambient !== 'none' &&
    ambientVolume > 0 &&
    session?.kind === 'focus' &&
    session.status === 'running'
  // Every open tab sees the session, so one tab is elected to play the bed.
  const [ambientOwner, setAmbientOwner] = useState(false)
  useEffect(() => {
    if (!wantAmbient) return undefined
    return electAmbientOwner(browserElection(), setAmbientOwner)
  }, [wantAmbient])
  const playAmbient = wantAmbient && ambientOwner
  const bedVolume = useEffectEvent(() => ambientVolume)
  // The audio code is loaded when it is first needed, not with the app. Arming the unlock makes the next
  // key press or click create the audio context, so it is done only while a phase is running for someone
  // who has sounds on (the chime at its end needs it) and never otherwise.
  useEffect(() => {
    if (running && soundEnabled) void import('@/lib/audio').then((audio) => audio.armAudioUnlock())
  }, [running, soundEnabled])
  useEffect(() => {
    if (!playAmbient) return undefined
    let cancelled = false
    void import('@/lib/audio').then((audio) => {
      if (!cancelled) void audio.startAmbient(ambient, bedVolume())
    })
    return () => {
      cancelled = true
      void import('@/lib/audio').then((audio) => audio.stopAmbient())
    }
  }, [playAmbient, ambient])
  useEffect(() => {
    if (playAmbient)
      void import('@/lib/audio').then((audio) => audio.setAmbientVolume(ambientVolume))
  }, [playAmbient, ambientVolume])

  const askedId = end.id
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
      {askedId !== null ? (
        <Suspense fallback={null}>
          <EndDialog
            key={askedId}
            sessionId={askedId}
            open={end.open}
            onClose={() => closeEnd(askedId)}
          />
        </Suspense>
      ) : null}
    </TimerContext.Provider>
  )
}
