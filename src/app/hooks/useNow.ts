import { useSyncExternalStore } from 'react'

export type NowGranularity = 'second' | 'minute'

const PERIOD: Record<NowGranularity, number> = { second: 1_000, minute: 60_000 }

interface Ticker {
  value: number
  listeners: Set<() => void>
  timer: ReturnType<typeof setTimeout> | null
}

const tickers: Record<NowGranularity, Ticker> = {
  second: { value: 0, listeners: new Set(), timer: null },
  minute: { value: 0, listeners: new Set(), timer: null },
}

function floorTo(g: NowGranularity, ms: number): number {
  return ms - (ms % PERIOD[g])
}

function schedule(g: NowGranularity): void {
  const t = tickers[g]
  if (t.timer !== null || t.listeners.size === 0) return
  const now = Date.now()
  // Wake just after the next boundary (never faster than 250 ms, which also keeps a frozen test clock calm).
  const delay = Math.max(250, PERIOD[g] - (now % PERIOD[g]) + 5)
  t.timer = setTimeout(() => {
    t.timer = null
    const next = floorTo(g, Date.now())
    if (next !== t.value) {
      t.value = next
      t.listeners.forEach((l) => l())
    }
    schedule(g)
  }, delay)
}

function subscribeTo(g: NowGranularity) {
  return (onChange: () => void) => {
    const t = tickers[g]
    t.listeners.add(onChange)
    // Catch up if the value went stale while nobody was subscribed.
    const fresh = floorTo(g, Date.now())
    if (fresh !== t.value) {
      t.value = fresh
      onChange()
    }
    schedule(g)
    return () => {
      t.listeners.delete(onChange)
      if (t.listeners.size === 0 && t.timer !== null) {
        clearTimeout(t.timer)
        t.timer = null
      }
    }
  }
}

const subscribers = { second: subscribeTo('second'), minute: subscribeTo('minute') }

function snapshot(g: NowGranularity): number {
  const t = tickers[g]
  if (t.listeners.size === 0) t.value = floorTo(g, Date.now())
  else if (t.value === 0) t.value = floorTo(g, Date.now())
  return t.value
}

/** Epoch ms, floored to `granularity`, re-rendering the caller at each boundary. Logic functions take this as `now`. */
export function useNow(granularity: NowGranularity = 'minute'): number {
  return useSyncExternalStore(
    subscribers[granularity],
    () => snapshot(granularity),
    () => 0,
  )
}
