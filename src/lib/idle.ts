/**
 * Small scheduling helpers for work that must not compete with the interface: `whenIdle` runs a job once the
 * browser has nothing better to do, `yieldToMain` lets input and painting in between the steps of a long job.
 */

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

/**
 * Runs `job` when the browser is idle, at the latest `timeout` ms from now (a tab that is never idle still
 * gets its job done). Waits `delayMs` first, so a start-up chore never overlaps the first paint. Returns
 * a cancel function. Where `requestIdleCallback` is missing (Safari) it falls back to a timer.
 */
export function whenIdle(
  job: () => void,
  { delayMs = 0, timeout = 10_000 }: { delayMs?: number; timeout?: number } = {},
): () => void {
  let cancelled = false
  let idleId: number | null = null
  const run = () => {
    if (!cancelled) job()
  }
  const timer = window.setTimeout(() => {
    const w = window as IdleWindow
    if (typeof w.requestIdleCallback === 'function')
      idleId = w.requestIdleCallback(run, { timeout })
    else run()
  }, delayMs)
  return () => {
    cancelled = true
    window.clearTimeout(timer)
    const w = window as IdleWindow
    if (idleId !== null) w.cancelIdleCallback?.(idleId)
  }
}

type Scheduler = { scheduler?: { yield?: () => Promise<void> } }

/** Gives the main thread back for a moment (`scheduler.yield` where it exists, else a zero timer). */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as Scheduler).scheduler
  if (typeof s?.yield === 'function') return s.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}
