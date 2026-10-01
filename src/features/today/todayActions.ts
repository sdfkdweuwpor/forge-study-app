import { useEffect, useRef } from 'react'
import { navigate } from '@/app/router'

/**
 * Today's one-click actions, reachable from the command palette on any page. A command navigates to
 * Today and files a request; the page performs it as soon as its tasks have loaded (or at once when
 * it is already open), so the Undo toast and completion motion appear where the user can see them.
 */
export type TodayAction = 'completeNow' | 'skipNow' | 'moveCarriedOver'

type Listener = (action: TodayAction) => void

/** A request nobody picked up (the page never opened) is dropped after this long. */
const PENDING_MS = 10_000

const listeners = new Set<Listener>()
let pending: { action: TodayAction; at: number } | null = null

/** Asks the Today page to run `action`, opening the page first if needed. */
export function requestTodayAction(action: TodayAction): void {
  if (listeners.size > 0) {
    listeners.forEach((listener) => listener(action))
    return
  }
  pending = { action, at: Date.now() }
  navigate('today')
}

/**
 * Runs `handle` for each request. A request filed before the page mounted is delivered once `ready`
 * turns true, so `handle` can rely on loaded data.
 */
export function useTodayActionRequests(handle: Listener, ready: boolean): void {
  const latest = useRef(handle)
  useEffect(() => {
    latest.current = handle
  })

  useEffect(() => {
    if (!ready) return undefined
    const listener: Listener = (action) => latest.current(action)
    listeners.add(listener)
    if (pending) {
      const { action, at } = pending
      pending = null
      if (Date.now() - at < PENDING_MS) listener(action)
    }
    return () => {
      listeners.delete(listener)
    }
  }, [ready])
}
