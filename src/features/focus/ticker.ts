/**
 * Starts the timer's heartbeat and returns a way to stop it. The beat comes from `timerWorker.ts`
 * (a Web Worker, so a hidden tab does not throttle it). If the worker cannot be created or fails to
 * load, the beat falls back to a main-thread interval: the timer is then only as punctual as the
 * browser allows in a background tab, and every tick still recomputes from timestamps, so it stays
 * correct.
 */
import type { WorkerCommand } from './timerWorker'

/** Interval of the fallback beat; the same as the worker's. */
const FALLBACK_MS = 250

export interface Ticker {
  stop(): void
}

export function startTicker(onTick: () => void): Ticker {
  let worker: Worker | null = null
  let fallback: ReturnType<typeof setInterval> | undefined
  let stopped = false

  const startFallback = () => {
    if (stopped || fallback !== undefined) return
    fallback = setInterval(onTick, FALLBACK_MS)
  }
  const send = (command: WorkerCommand) => worker?.postMessage(command)

  try {
    worker = new Worker(new URL('./timerWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = () => {
      if (!stopped) onTick()
    }
    worker.onerror = () => {
      worker?.terminate()
      worker = null
      startFallback()
    }
    send({ type: 'start' })
  } catch {
    worker = null
    startFallback()
  }

  return {
    stop() {
      stopped = true
      if (fallback !== undefined) clearInterval(fallback)
      fallback = undefined
      if (worker) {
        send({ type: 'stop' })
        worker.terminate()
        worker = null
      }
    },
  }
}
