/**
 * Time budgets for unit tests that do not flake when the machine is busy.
 *
 * Wall-clock time measures the machine as much as the code: with other builds and browsers running,
 * a 10 ms plan was measured at 232–470 ms. So budgets are checked in CPU time spent by this thread
 * (`process.threadCpuUsage`, falling back to the process, then to wall time), which a busy neighbour
 * barely moves, and as the median of several runs after a warm-up, so one GC pause or a JIT tier-up
 * cannot decide the result. Keep a margin of 3x or more over the typical figure anyway: the budget is
 * there to catch an accidental quadratic, not a 20 % regression.
 *
 * Test-only; never import this from app code.
 */

type Usage = { user: number; system: number }
type CpuClock = () => number

const cpuClock = (): CpuClock => {
  const proc = typeof process === 'undefined' ? undefined : process
  const thread = proc?.threadCpuUsage?.bind(proc) as (() => Usage) | undefined
  const whole = proc?.cpuUsage?.bind(proc) as (() => Usage) | undefined
  const read = thread ?? whole
  if (read) {
    return () => {
      const u = read()
      return (u.user + u.system) / 1000
    }
  }
  return () => performance.now()
}

/** Milliseconds of CPU used by this thread so far (or wall time where that cannot be read). */
export const cpuNow: CpuClock = cpuClock()

const median = (xs: readonly number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Median CPU milliseconds of `runs` calls of `fn`, after one warm-up call that is not counted. */
export function medianCpuMs(fn: () => unknown, runs = 5): number {
  fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = cpuNow()
    fn()
    times.push(cpuNow() - t0)
  }
  return median(times)
}

/**
 * `medianCpuMs` for async work (database calls). Only CPU this thread spends counts, so time spent
 * waiting is free; let domain events settle before measuring, or their handlers are counted too.
 * `warmUp: false` when the first call is the one to measure (it changes what the next call does).
 */
export async function medianCpuMsAsync(
  fn: () => Promise<unknown>,
  runs = 3,
  opts: { warmUp?: boolean } = {},
): Promise<number> {
  if (opts.warmUp !== false) await fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = cpuNow()
    await fn()
    times.push(cpuNow() - t0)
  }
  return median(times)
}
