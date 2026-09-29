/**
 * The timer's heartbeat. A module Web Worker that posts a `tick` every 250 ms while it is running.
 *
 * It only says "wake up": the page reads `Date.now()` itself and recomputes everything from the
 * session's timestamps, so a late, early or missed tick can never make the timer drift. A worker is
 * used because the main thread's timers are throttled to about once a minute in a hidden tab, which
 * would make the chime and the notification late (DECISIONS: timer ticks run in a module Web Worker).
 *
 * Vite builds this file as a separate script (`new Worker(new URL('./timerWorker.ts', import.meta.url))`),
 * so it is served from the app's own origin and passes `worker-src 'self'`.
 */

export type WorkerCommand = { type: 'start' } | { type: 'stop' }

/** What the worker knows about itself; the DOM and WebWorker libs disagree on `self`, so it is typed here. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null
  postMessage(message: 'tick'): void
}

const TICK_MS = 250

const scope = self as unknown as WorkerScope
let handle: ReturnType<typeof setInterval> | undefined

scope.onmessage = (event) => {
  if (event.data.type === 'start') {
    if (handle === undefined) handle = setInterval(() => scope.postMessage('tick'), TICK_MS)
  } else if (handle !== undefined) {
    clearInterval(handle)
    handle = undefined
  }
}
