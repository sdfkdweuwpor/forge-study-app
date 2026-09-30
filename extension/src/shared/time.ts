/** Small pure time helpers shared by the service worker and the pages. */

/** The LOCAL calendar day as `YYYY-MM-DD`. (`toISOString()` is a UTC day and rolls over at 8pm in New York.) */
export function localDayKey(ms: number): string {
  const d = new Date(ms)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** Whole seconds left until `endsAt`, never negative. Rounded up, so the display reads 0:00 only when time is up. */
export function secondsLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000))
}

/** `24:31`, or `1:05:09` from an hour up. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
  return `${String(minutes).padStart(2, '0')}:${ss}`
}
