/**
 * What the app currently knows about the extension: one small store, shared by the sync provider
 * (which keeps it fresh) and every screen that shows it (the Blocker page, the Today card, the
 * Progress sections). It lives in memory only: the answer is only true for this session of the page.
 */
import { useSyncExternalStore } from 'react'
import type { BridgeFailure } from './bridge'

export type Connection =
  /** Nobody has asked yet (the first ping is on its way). */
  | { phase: 'checking'; version: null; reason: null; message: null; checkedAt: null }
  | { phase: 'connected'; version: string; reason: null; message: null; checkedAt: number }
  | {
      phase: 'unavailable'
      version: null
      reason: BridgeFailure
      message: string
      checkedAt: number
    }

const CHECKING: Connection = {
  phase: 'checking',
  version: null,
  reason: null,
  message: null,
  checkedAt: null,
}

let current: Connection = CHECKING
const listeners = new Set<() => void>()

export function getConnection(): Connection {
  return current
}

export function setConnected(version: string, at: number): void {
  if (current.phase === 'connected' && current.version === version) {
    // Same answer: keep the snapshot so nothing re-renders every minute.
    return
  }
  current = { phase: 'connected', version, reason: null, message: null, checkedAt: at }
  for (const l of listeners) l()
}

export function setUnavailable(reason: BridgeFailure, message: string, at: number): void {
  if (current.phase === 'unavailable' && current.reason === reason && current.message === message)
    return
  current = { phase: 'unavailable', version: null, reason, message, checkedAt: at }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The extension's connection state, live. */
export function useConnection(): Connection {
  return useSyncExternalStore(subscribe, getConnection, getConnection)
}

/** True once a ping has been answered. Anything short of that (no API, wrong id, no answer) is not connected. */
export function isConnected(c: Connection): boolean {
  return c.phase === 'connected'
}
