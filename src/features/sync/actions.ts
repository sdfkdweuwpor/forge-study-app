/**
 * What the Settings → Sync buttons do (PLAN §4.7.7): check and save the project, send the sign-in email,
 * sign in with the code or the link, sign out. It is the glue between the screen, the Supabase calls
 * (`supabase/auth`) and the sync lifecycle in `@/db/repos/sync`, and it is loaded only when one of those
 * buttons is pressed. Every function answers with a plain result, never throws, and words a failure in
 * one calm sentence: nothing the server said, no address, no key and no token is ever put in a message.
 * `deps` lets a test pass a fake `fetch` and clock.
 */
import { recordError } from '@/app/reportError'
import {
  getSyncSession,
  getSyncState,
  savePendingLogin,
  saveSyncConfig,
  startSync,
  stopSync,
} from '@/db/repos/sync'
import type { SyncSession } from '@/db/types'
import { validateSyncConfig, type ConfigIssue } from '@/logic/syncConfig'
import {
  GENERIC_TEXT,
  OTHER_BROWSER_TEXT,
  cleanEmailCode,
  looksLikeEmail,
} from '@/logic/syncLink'
import { browserSend, transportOf } from './client'
import { resumeAfterSignIn, stopEngine } from './engine'
import {
  checkProject,
  exchangeAuthCode,
  sendSignInEmail,
  signInWithCode,
  signOut,
} from './supabase/auth'
import { SupabaseError, type Send } from './supabase/http'

export interface ActionDeps {
  send: Send
  now: () => number
  /** `location.origin`: the magic link comes back to `${origin}/settings/sync`. */
  origin: string
  /** The engine's hooks, so a test does not start one. */
  resume: () => void
  halt: () => void
}

const withDefaults = (deps: Partial<ActionDeps>): ActionDeps => ({
  send: deps.send ?? browserSend(),
  now: deps.now ?? (() => Date.now()),
  origin: deps.origin ?? window.location.origin,
  resume: deps.resume ?? resumeAfterSignIn,
  halt: deps.halt ?? stopEngine,
})

export type Outcome = { ok: true } | { ok: false; message: string }

export const EMAIL_OFF_TEXT =
  'Email sign-in is switched off in this project. In Supabase, open Authentication, then Providers, and turn on Email.'
export const NEEDS_PROJECT_TEXT = 'Set up the project first.'
export const NEEDS_EMAIL_TEXT = 'Enter the email address you sign in with.'
export const NEEDS_CODE_TEXT = 'Type the code from the email: 6 to 10 digits.'
export const NEEDS_SEND_TEXT = 'Send a sign-in email first.'

/** A transport failure already carries a fixed, calm sentence; anything else is ours to log, not to show. */
function failed(error: unknown, where: string): { ok: false; message: string } {
  if (error instanceof SupabaseError) return { ok: false, message: error.message }
  recordError(error, where)
  return { ok: false, message: GENERIC_TEXT }
}

// ─── Setting up ─────────────────────────────────────────────────────────────

export type CheckResult =
  | { ok: true }
  /** `issues` are the fields' own reasons (shown under them); `message` is about the project as a whole. */
  | { ok: false; issues: readonly ConfigIssue[]; message: string | null }

/**
 * "Check connection": both fields must pass the checks of `logic/syncConfig`, then `/auth/v1/settings`
 * must answer for this key with email sign-in on. Only then is the project saved (it stays on this
 * device); a failed check saves nothing.
 */
export async function checkAndSaveProject(
  urlInput: string,
  keyInput: string,
  deps: Partial<ActionDeps> = {},
): Promise<CheckResult> {
  const { send } = withDefaults(deps)
  const parsed = validateSyncConfig(urlInput, keyInput)
  if (!parsed.ok) return { ok: false, issues: parsed.issues, message: null }
  const { config } = parsed
  try {
    const check = await checkProject(send, config)
    if (!check.emailEnabled) return { ok: false, issues: [], message: EMAIL_OFF_TEXT }
    await saveSyncConfig({ url: config.url, anonKey: config.anonKey })
    return { ok: true }
  } catch (error) {
    return { ...failed(error, 'sync.check'), issues: [] }
  }
}

// ─── Signing in ─────────────────────────────────────────────────────────────

/** The person is in: sync turns on for this device, and the engine starts (a second later for a new device). */
async function finishSignIn(session: SyncSession, deps: ActionDeps): Promise<void> {
  await startSync(session)
  deps.resume()
}

/**
 * Sends the sign-in email (a link and, with the project's template, a code) and remembers the PKCE
 * verifier, the address and when it was sent, so the link or the code can finish the job later.
 */
export async function sendSignInLink(
  email: string,
  deps: Partial<ActionDeps> = {},
): Promise<Outcome> {
  const { send, now, origin } = withDefaults(deps)
  const address = email.trim()
  if (!looksLikeEmail(address)) return { ok: false, message: NEEDS_EMAIL_TEXT }
  try {
    const config = transportOf(await getSyncState())
    if (config === null) return { ok: false, message: NEEDS_PROJECT_TEXT }
    const { codeVerifier } = await sendSignInEmail(send, config, {
      email: address,
      redirectTo: `${origin}/settings/sync`,
    })
    await saveSyncConfig({ url: config.url, anonKey: config.anonKey, email: address })
    await savePendingLogin({ email: address, codeVerifier, requestedAt: now() })
    return { ok: true }
  } catch (error) {
    return failed(error, 'sync.sendLink')
  }
}

/** Forgets the sign-in in progress ("Use another email"). */
export async function forgetPendingLogin(): Promise<void> {
  await savePendingLogin(null)
}

/** The code typed from the email: the way in for an installed phone app, which a mail link cannot reach. */
export async function signInWithEmailCode(
  code: string,
  deps: Partial<ActionDeps> = {},
): Promise<Outcome> {
  const d = withDefaults(deps)
  const digits = cleanEmailCode(code)
  if (digits === null) return { ok: false, message: NEEDS_CODE_TEXT }
  try {
    const state = await getSyncState()
    const config = transportOf(state)
    const email = state?.pendingLogin?.email ?? state?.email ?? null
    if (config === null) return { ok: false, message: NEEDS_PROJECT_TEXT }
    if (email === null) return { ok: false, message: NEEDS_SEND_TEXT }
    const session = await signInWithCode(d.send, config, { email, code: digits }, d.now())
    await finishSignIn(session, d)
    return { ok: true }
  } catch (error) {
    return failed(error, 'sync.signInWithCode')
  }
}

/**
 * The link came back as `?code=…` on `/settings/sync`: exchange it with the verifier this device kept.
 * A browser that never asked for a link has no verifier, which is the "different browser" case.
 */
export async function exchangeLinkCode(
  authCode: string,
  deps: Partial<ActionDeps> = {},
): Promise<Outcome> {
  const d = withDefaults(deps)
  try {
    const state = await getSyncState()
    const config = transportOf(state)
    const pending = state?.pendingLogin ?? null
    if (config === null || pending === null) return { ok: false, message: OTHER_BROWSER_TEXT }
    const session = await exchangeAuthCode(
      d.send,
      config,
      { authCode, codeVerifier: pending.codeVerifier },
      d.now(),
    )
    await finishSignIn(session, d)
    return { ok: true }
  } catch (error) {
    return failed(error, 'sync.exchangeLink')
  }
}

// ─── Signing out ────────────────────────────────────────────────────────────

/**
 * "Sign out and stop syncing": this tab's engine stops, tracking goes off in every tab, the bookkeeping
 * resets (the project and the email stay) and the outbox is cleared. Local data and the cloud copy are
 * untouched. Ending the session on the server is best effort and never waited for.
 */
export async function signOutAndStop(deps: Partial<ActionDeps> = {}): Promise<Outcome> {
  const d = withDefaults(deps)
  try {
    const [session, state] = await Promise.all([getSyncSession(), getSyncState()])
    const config = transportOf(state)
    d.halt()
    await stopSync()
    if (session !== null && config !== null) void signOut(d.send, config, session)
    return { ok: true }
  } catch (error) {
    return failed(error, 'sync.signOut')
  }
}
