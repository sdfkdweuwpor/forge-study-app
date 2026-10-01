/**
 * Sign-in calls to GoTrue (PLAN §4.7.1), thin over `logic/syncRequests` and `http`. Nothing is stored
 * here: sessions and the PKCE verifier go in and out as plain objects, and the engine keeps them in
 * `syncState`. `now` is the time the call is made, on this device's clock (see `parseSession`).
 * Every failure is a `SupabaseError`, except `signOut`, which never fails.
 */
import type { Millis, SyncSession } from '@/db/types'
import { codeChallengeS256, createCodeVerifier } from '@/lib/pkce'
import {
  logoutRequest,
  otpRequest,
  parseSession,
  parseSettings,
  parseUser,
  pkceRequest,
  refreshRequest,
  settingsRequest,
  userRequest,
  verifyRequest,
  type SessionAuth,
  type TransportConfig,
} from '@/logic/syncRequests'
import { badAnswer, type Send } from './http'

/** What the project's Auth settings say. */
export interface ProjectCheck {
  /** Email sign-in is on. Off means Forge cannot sign anyone in. */
  emailEnabled: boolean
  /** A new address may create an account (needed for the first sign-in). */
  signupsOpen: boolean
}

/** "Check connection": a right address and key answer; a wrong key is `badKey`, a wrong address `offline`. */
export async function checkProject(send: Send, config: TransportConfig): Promise<ProjectCheck> {
  const check = parseSettings(await send(settingsRequest(config)))
  if (check === null) throw badAnswer()
  return check
}

/**
 * Email a sign-in link and code. Returns the PKCE verifier: keep it (with the email) until the link comes
 * back or a code is typed, then pass it to `exchangeAuthCode`.
 */
export async function sendSignInEmail(
  send: Send,
  config: TransportConfig,
  input: { email: string; redirectTo: string },
): Promise<{ codeVerifier: string }> {
  const codeVerifier = createCodeVerifier()
  const codeChallenge = await codeChallengeS256(codeVerifier)
  await send(otpRequest(config, { ...input, codeChallenge }))
  return { codeVerifier }
}

/** The code typed from the email (the way in for an installed phone app). */
export async function signInWithCode(
  send: Send,
  config: TransportConfig,
  input: { email: string; code: string },
  now: Millis,
): Promise<SyncSession> {
  const session = parseSession(await send(verifyRequest(config, input)), now, {
    email: input.email.trim(),
  })
  if (session === null) throw badAnswer()
  return session
}

/** The link came back as `?code=…`: exchange it, with the verifier from `sendSignInEmail`. */
export async function exchangeAuthCode(
  send: Send,
  config: TransportConfig,
  input: { authCode: string; codeVerifier: string },
  now: Millis,
): Promise<SyncSession> {
  const session = parseSession(await send(pkceRequest(config, input)), now)
  if (session === null) throw badAnswer()
  return session
}

/**
 * A new session from the refresh token. Supabase rotates it: store the returned one and drop the old,
 * and do not run two refreshes at once. A refused refresh is `unauthorized` (sign in again).
 */
export async function refreshSession(
  send: Send,
  config: TransportConfig,
  session: SyncSession,
  now: Millis,
): Promise<SyncSession> {
  const next = parseSession(await send(refreshRequest(config, session.refreshToken)), now, {
    userId: session.userId,
    email: session.email,
  })
  if (next === null) throw badAnswer()
  return next
}

/** The account the session belongs to. */
export async function fetchUser(
  send: Send,
  config: TransportConfig,
  session: SessionAuth,
): Promise<{ id: string; email: string }> {
  const user = parseUser(await send(userRequest(config, session)))
  if (user === null) throw badAnswer()
  return user
}

/** End this device's session on the server. Best effort: resolves `false` on any failure, never throws. */
export async function signOut(
  send: Send,
  config: TransportConfig,
  session: SessionAuth,
): Promise<boolean> {
  try {
    await send(logoutRequest(config, session))
    return true
  } catch {
    return false
  }
}
