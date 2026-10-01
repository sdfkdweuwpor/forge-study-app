/**
 * Pure decisions behind the "Update ready" prompt (src/app/pwa). The service worker is registered with
 * `registerType: 'prompt'`: a new version waits, and only a tap on "Reload" swaps it in. On top of
 * that the prompt itself stays quiet while a focus or break session is running, so nothing on screen
 * pulls attention away from it (and nothing reloads the page under it).
 */

/** What the prompt host should do with the toast right now. */
export type PromptAction = 'show' | 'hide' | 'none'

export interface PromptInput {
  /** A newer version is installed and waiting (or already active, in a tab that has not reloaded). */
  updateReady: boolean
  /** A session is running or paused. `undefined` while that is still being read. */
  sessionActive: boolean | undefined
  /** The toast is on screen (as far as the host knows). */
  shown: boolean
}

/**
 * Show the toast once an update is ready and no session runs; take it down when a session starts while
 * it is showing (it comes back after the session ends). While the session state is unknown, do nothing:
 * showing first and hiding a moment later would flash the toast at someone mid-session.
 */
export function promptAction({ updateReady, sessionActive, shown }: PromptInput): PromptAction {
  if (!updateReady || sessionActive === undefined) return 'none'
  if (sessionActive) return shown ? 'hide' : 'none'
  return shown ? 'none' : 'show'
}

export interface CheckInput {
  /** When the last check for a newer version started, in ms; `null` if none has yet. */
  lastCheckAt: number | null
  now: number
  online: boolean
  /** Least time between two checks, in ms. */
  minGapMs: number
}

/**
 * Whether to ask the server for a newer service worker now. An installed app can stay open for days
 * without a navigation (which is what normally makes the browser look), so the host checks now and then
 * and whenever the app comes back to the foreground. Never while offline, never twice within `minGapMs`.
 */
export function updateCheckDue({ lastCheckAt, now, online, minGapMs }: CheckInput): boolean {
  if (!online) return false
  return lastCheckAt === null || now - lastCheckAt >= minGapMs
}
