import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { SyncSession } from '@/db/types'
import type { KeyKind } from '@/logic/syncConfig'
import type { TransportConfig } from '@/logic/syncRequests'
import {
  checkProject,
  exchangeAuthCode,
  fetchUser,
  refreshSession,
  sendSignInEmail,
  signInWithCode,
  signOut,
} from './auth'
import { createHttp, SupabaseError, suggestsPaused, type FetchLike } from './http'

const URL_OK = 'https://abcdefghijklmnopqrst.supabase.co'
const ANON_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl'
const PUBLISHABLE = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
const cfg = (keyKind: KeyKind): TransportConfig => ({
  url: URL_OK,
  anonKey: keyKind === 'anonJwt' ? ANON_JWT : PUBLISHABLE,
  keyKind,
})
const NOW = 1_780_000_000_000
const SESSION: SyncSession = {
  accessToken: 'access-old',
  refreshToken: 'refresh-old',
  expiresAt: NOW - 1,
  userId: 'user-0001',
  email: 'ana@example.com',
}

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}
type Handler = (call: Call) => Response

function harness(handler: Handler) {
  const calls: Call[] = []
  const fetchLike: FetchLike = (url, init) => {
    const call: Call = {
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    }
    calls.push(call)
    return Promise.resolve(handler(call))
  }
  return { calls, send: createHttp({ fetch: fetchLike }) }
}

const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status })

const tokenAnswer = (over: Record<string, unknown> = {}) => ({
  access_token: 'access-new',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: NOW / 1000 + 3600,
  refresh_token: 'refresh-new',
  user: { id: 'user-0001', email: 'ana@example.com' },
  ...over,
})

async function rejection(promise: Promise<unknown>): Promise<SupabaseError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(SupabaseError)
  return error as SupabaseError
}

describe('checkProject', () => {
  it('asks /auth/v1/settings with the key and says what the project allows', async () => {
    const h = harness(() => json(200, { external: { email: true }, disable_signup: false }))
    expect(await checkProject(h.send, cfg('anonJwt'))).toEqual({
      emailEnabled: true,
      signupsOpen: true,
    })
    expect(h.calls[0]).toMatchObject({ method: 'GET', url: `${URL_OK}/auth/v1/settings` })
    expect(h.calls[0]?.headers.apikey).toBe(ANON_JWT)
  })

  it('reports email sign-in switched off, and sign-ups closed', async () => {
    const h = harness(() => json(200, { external: { email: false }, disable_signup: true }))
    expect(await checkProject(h.send, cfg('publishable'))).toEqual({
      emailEnabled: false,
      signupsOpen: false,
    })
  })

  it('says badKey for a 401 and offline for an address that does not answer', async () => {
    const wrongKey = harness(() => json(401, { message: 'Invalid API key' }))
    expect(await rejection(checkProject(wrongKey.send, cfg('anonJwt')))).toMatchObject({
      reason: 'badKey',
      status: 401,
    })
    const send = createHttp({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) })
    expect(await rejection(checkProject(send, cfg('anonJwt')))).toMatchObject({
      reason: 'offline',
      kind: 'offline',
    })
  })

  it('reports a 540 as an outage that may be a paused project, and a page that is not a Supabase answer', async () => {
    const paused = harness(() => json(540))
    const error = await rejection(checkProject(paused.send, cfg('anonJwt')))
    expect(error).toMatchObject({ reason: 'unavailable', status: 540 })
    expect(suggestsPaused(error)).toBe(true)
    for (const body of ['<html>parked domain</html>', '{}', '[]']) {
      const odd = harness(() => new Response(body, { status: 200 }))
      expect(await rejection(checkProject(odd.send, cfg('anonJwt')))).toMatchObject({
        reason: 'rejected',
      })
    }
  })
})

describe('sendSignInEmail', () => {
  it('posts the PKCE challenge of a fresh verifier and returns that verifier', async () => {
    const h = harness(() => json(200, {}))
    const { codeVerifier } = await sendSignInEmail(h.send, cfg('anonJwt'), {
      email: 'ana@example.com',
      redirectTo: 'https://forge-study-app.netlify.app/settings/sync',
    })
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43)
    expect(codeVerifier.length).toBeLessThanOrEqual(128)
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-._~]+$/)

    const call = h.calls[0] as Call
    expect(call.method).toBe('POST')
    expect(call.url).toBe(
      `${URL_OK}/auth/v1/otp?redirect_to=https%3A%2F%2Fforge-study-app.netlify.app%2Fsettings%2Fsync`,
    )
    expect(call.body).toEqual({
      email: 'ana@example.com',
      create_user: true,
      data: {},
      code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
      code_challenge_method: 's256',
    })
  })

  it('never sends the verifier itself', async () => {
    const h = harness(() => json(200, {}))
    const { codeVerifier } = await sendSignInEmail(h.send, cfg('publishable'), {
      email: 'ana@example.com',
      redirectTo: 'https://forge-study-app.netlify.app/settings/sync',
    })
    const wire = JSON.stringify(h.calls[0])
    expect(wire).not.toContain(codeVerifier)
  })

  it('makes a new verifier and challenge every time', async () => {
    const h = harness(() => json(200, {}))
    const input = { email: 'ana@example.com', redirectTo: '' }
    const a = await sendSignInEmail(h.send, cfg('anonJwt'), input)
    const b = await sendSignInEmail(h.send, cfg('anonJwt'), input)
    expect(a.codeVerifier).not.toBe(b.codeVerifier)
    const challenge = (i: number) => (h.calls[i]?.body as { code_challenge: string }).code_challenge
    expect(challenge(0)).not.toBe(challenge(1))
  })

  it('surfaces a rate limit as a calm wait, with the code the form can key on', async () => {
    const h = harness(() => json(429, { code: 'over_email_send_rate_limit' }))
    const error = await rejection(
      sendSignInEmail(h.send, cfg('anonJwt'), { email: 'ana@example.com', redirectTo: '' }),
    )
    expect(error).toMatchObject({
      reason: 'rateLimited',
      kind: 'rateLimited',
      code: 'over_email_send_rate_limit',
    })
  })

  it('tells a closed project apart when a new address cannot be created', async () => {
    const h = harness(() => json(422, { code: 'signup_disabled', msg: 'Signups not allowed' }))
    const error = await rejection(
      sendSignInEmail(h.send, cfg('anonJwt'), { email: 'new@example.com', redirectTo: '' }),
    )
    expect(error.code).toBe('signup_disabled')
    expect(error.message).toMatch(/new accounts/)
  })
})

describe('signInWithCode', () => {
  it('verifies the code as type "email" and returns a session', async () => {
    const h = harness(() => json(200, tokenAnswer()))
    const session = await signInWithCode(
      h.send,
      cfg('anonJwt'),
      { email: ' ana@example.com ', code: '482 913' },
      NOW,
    )
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      url: `${URL_OK}/auth/v1/verify`,
      body: { type: 'email', email: 'ana@example.com', token: '482913' },
    })
    expect(session).toEqual({
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
      expiresAt: NOW + 3_600_000,
      userId: 'user-0001',
      email: 'ana@example.com',
    } satisfies SyncSession)
  })

  it('falls back to the typed email when the answer has none', async () => {
    const h = harness(() => json(200, tokenAnswer({ user: { id: 'user-0001' } })))
    const session = await signInWithCode(
      h.send,
      cfg('anonJwt'),
      { email: 'Ana@Example.com', code: '1' },
      NOW,
    )
    expect(session.email).toBe('Ana@Example.com')
  })

  it('says a wrong or old code has expired, and is not a sign-out of anything', async () => {
    const h = harness(() =>
      json(403, { code: 'otp_expired', msg: 'Token has expired or is invalid' }),
    )
    const error = await rejection(
      signInWithCode(h.send, cfg('anonJwt'), { email: 'ana@example.com', code: '000000' }, NOW),
    )
    expect(error).toMatchObject({ reason: 'unauthorized', code: 'otp_expired', status: 403 })
    expect(error.message).toMatch(/expired or was already used/)
  })

  it('rejects an answer without a session', async () => {
    const h = harness(() => json(200, { user: { id: 'u' } }))
    await expect(
      signInWithCode(h.send, cfg('anonJwt'), { email: 'ana@example.com', code: '1' }, NOW),
    ).rejects.toMatchObject({ reason: 'rejected' })
  })
})

describe('exchangeAuthCode', () => {
  it('trades the code and the verifier for a session', async () => {
    const h = harness(() => json(200, tokenAnswer()))
    const session = await exchangeAuthCode(
      h.send,
      cfg('publishable'),
      { authCode: 'pkce-abc', codeVerifier: 'v'.repeat(64) },
      NOW,
    )
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      url: `${URL_OK}/auth/v1/token?grant_type=pkce`,
      body: { auth_code: 'pkce-abc', code_verifier: 'v'.repeat(64) },
    })
    expect(h.calls[0]?.headers).not.toHaveProperty('Authorization')
    expect(session).toMatchObject({
      accessToken: 'access-new',
      userId: 'user-0001',
      expiresAt: NOW + 3_600_000,
    })
  })

  it('reports a link that was not started in this browser', async () => {
    for (const code of ['bad_code_verifier', 'flow_state_not_found', 'flow_state_expired']) {
      const h = harness(() => json(code === 'flow_state_not_found' ? 404 : 400, { code }))
      const error = await rejection(
        exchangeAuthCode(h.send, cfg('anonJwt'), { authCode: 'x', codeVerifier: 'y' }, NOW),
      )
      expect(error.code, code).toBe(code)
      expect(error.message, code).toMatch(/link/)
    }
  })
})

describe('refreshSession', () => {
  it('sends only the refresh token, with the anon bearer and never the old access token', async () => {
    const h = harness(() => json(200, tokenAnswer()))
    const next = await refreshSession(h.send, cfg('anonJwt'), SESSION, NOW)
    const call = h.calls[0] as Call
    expect(call.url).toBe(`${URL_OK}/auth/v1/token?grant_type=refresh_token`)
    expect(call.body).toEqual({ refresh_token: 'refresh-old' })
    expect(call.headers.Authorization).toBe(`Bearer ${ANON_JWT}`)
    expect(JSON.stringify(call)).not.toContain('access-old')
    // Supabase rotates the refresh token: the new one replaces the old.
    expect(next).toMatchObject({ accessToken: 'access-new', refreshToken: 'refresh-new' })
    expect(next.expiresAt).toBe(NOW + 3_600_000)
  })

  it('keeps who the session belongs to when the answer leaves the user out', async () => {
    const h = harness(() => json(200, tokenAnswer({ user: undefined })))
    expect(await refreshSession(h.send, cfg('publishable'), SESSION, NOW)).toMatchObject({
      userId: 'user-0001',
      email: 'ana@example.com',
    })
  })

  it('is signed out for a refused refresh token, whichever way the server says it', async () => {
    const answers: [number, unknown][] = [
      [400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' }],
      [400, { code: 'refresh_token_already_used' }],
      [400, { msg: 'Invalid Refresh Token' }],
      [401, { code: 'refresh_token_not_found' }],
    ]
    for (const [status, body] of answers) {
      const h = harness(() => json(status, body))
      expect(await rejection(refreshSession(h.send, cfg('anonJwt'), SESSION, NOW))).toMatchObject({
        reason: 'unauthorized',
        kind: 'signedOut',
      })
    }
  })

  it('is not signed out by an outage: a 5xx, a 429 or no network can simply be retried', async () => {
    const outages: [Response | Error, string][] = [
      [json(503), 'server'],
      [json(540), 'server'],
      [json(429), 'rateLimited'],
      [new TypeError('Failed to fetch'), 'offline'],
    ]
    for (const [outage, kind] of outages) {
      const send = createHttp({
        fetch: () =>
          outage instanceof Error ? Promise.reject(outage) : Promise.resolve(outage.clone()),
      })
      expect(await rejection(refreshSession(send, cfg('anonJwt'), SESSION, NOW))).toMatchObject({
        kind,
      })
    }
  })
})

describe('fetchUser', () => {
  it('gets the account with the session bearer', async () => {
    const h = harness(() =>
      json(200, { id: 'user-0001', email: 'ana@example.com', aud: 'authenticated' }),
    )
    expect(
      await fetchUser(h.send, cfg('publishable'), { accessToken: 'at', userId: 'user-0001' }),
    ).toEqual({
      id: 'user-0001',
      email: 'ana@example.com',
    })
    expect(h.calls[0]).toMatchObject({ method: 'GET', url: `${URL_OK}/auth/v1/user` })
    expect(h.calls[0]?.headers.Authorization).toBe('Bearer at')
  })

  it('reports an expired token and an unreadable answer', async () => {
    const expired = harness(() => json(401, { code: 'bad_jwt', msg: 'invalid JWT' }))
    expect(
      await rejection(fetchUser(expired.send, cfg('anonJwt'), { accessToken: 'at', userId: 'u' })),
    ).toMatchObject({ reason: 'unauthorized', kind: 'signedOut' })
    const odd = harness(() => json(200, {}))
    await expect(
      fetchUser(odd.send, cfg('anonJwt'), { accessToken: 'at', userId: 'u' }),
    ).rejects.toMatchObject({ reason: 'rejected' })
  })
})

describe('signOut', () => {
  it('logs out this device only, with the session bearer', async () => {
    const h = harness(() => json(204))
    expect(await signOut(h.send, cfg('anonJwt'), { accessToken: 'at', userId: 'u' })).toBe(true)
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      url: `${URL_OK}/auth/v1/logout?scope=local`,
    })
    expect(h.calls[0]?.headers.Authorization).toBe('Bearer at')
  })

  it('is best effort: it resolves false, never throws, whatever the server or network does', async () => {
    const failures: (Response | Error)[] = [
      json(401, { code: 'bad_jwt' }),
      json(403, { code: 'session_not_found' }),
      json(404),
      json(500),
      json(429),
      new Response('not json', { status: 200 }),
      new TypeError('Failed to fetch'),
    ]
    for (const failure of failures) {
      const send = createHttp({
        fetch: () =>
          failure instanceof Error ? Promise.reject(failure) : Promise.resolve(failure.clone()),
      })
      expect(await signOut(send, cfg('anonJwt'), { accessToken: 'at', userId: 'u' })).toBe(false)
    }
  })
})
