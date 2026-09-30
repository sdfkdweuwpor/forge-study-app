/**
 * The sign-in link coming back, as a small external store (React reads it with `useSyncExternalStore`).
 * The section hands it what `parseLinkReturn` found in the address; it exchanges the code (once per code,
 * so a development double-render or a reload cannot spend a single-use code twice) and keeps the answer
 * for the screen: "working", or a calm sentence when the link did not work.
 */
import { GENERIC_TEXT, linkErrorMessage, type LinkReturn } from '@/logic/syncLink'
import type { Outcome } from './actions'

export interface LinkState {
  working: boolean
  message: string | null
}

const IDLE: LinkState = { working: false, message: null }
let state: LinkState = IDLE
const listeners = new Set<() => void>()
/** Codes already taken: an auth code works once. */
const taken = new Set<string>()

const set = (next: LinkState): void => {
  state = next
  for (const listener of [...listeners]) listener()
}

export const getLinkState = (): LinkState => state

export function subscribeLinkState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Dismisses the message (the person sent a new link, or closed it). */
export function clearLinkMessage(): void {
  if (state.message !== null) set(IDLE)
}

const exchangeLater = async (code: string): Promise<Outcome> =>
  (await import('./actions')).exchangeLinkCode(code)

/**
 * What to do with the link's answer. An error shows its sentence; a code is exchanged, on success
 * sync is on (the section then shows the first sync) and on failure the reason is shown.
 */
export function handleLinkReturn(
  ret: LinkReturn,
  exchange: (code: string) => Promise<Outcome> = exchangeLater,
): void {
  if (ret.kind === 'error') {
    set({ working: false, message: linkErrorMessage(ret.errorCode) })
    return
  }
  if (taken.has(ret.code)) return
  taken.add(ret.code)
  set({ working: true, message: null })
  exchange(ret.code).then(
    (outcome) => set({ working: false, message: outcome.ok ? null : outcome.message }),
    () => set({ working: false, message: GENERIC_TEXT }),
  )
}

/** Test helper: forget every code and message. */
export function resetLinkReturnForTests(): void {
  taken.clear()
  set(IDLE)
}
