import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAllData } from '@/db/repos/backup'
import { getSyncSession, getSyncState, pendingChangeCount } from '@/db/repos/sync'
import { createTask } from '@/db/repos/tasks'
import {
  NEEDS_CODE_TEXT,
  NEEDS_EMAIL_TEXT,
  OTHER_BROWSER_TEXT,
  linkErrorMessage,
} from '@/logic/syncLink'
import {
  EMAIL_OFF_TEXT,
  NEEDS_PROJECT_TEXT,
  NEEDS_SEND_TEXT,
  checkAndSaveProject,
  exchangeLinkCode,
  forgetPendingLogin,
  sendSignInLink,
  signInWithEmailCode,
  signOutAndStop,
  type ActionDeps,
} from './actions'
import { syncIsOn } from './queries'
import { createHttp, type FetchLike } from './supabase/http'

const URL_OK = 'https://abcdefghijklmnopqrst.supabase.co'
const REDIRECT = 'https://sdfkdweuwpor.github.io/forge-study-app/settings/sync'
const NOW = 1_790_000_000_000

const b64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
/** A JWT assembled at run time: no key-shaped text sits in this file. */
const jwt = (claims: object): string =>
  [b64url({ alg: 'HS256', typ: 'JWT' }), b64url(claims), 'c2lnbmF0dXJl'].join('.')
const ANON_KEY = jwt({ role: 'anon', ref: 'abcdefghijklmnopqrst' })
const SECRET_JWT = jwt({ role: 'service_role', ref: 'abcdefghijklmnopqrst' })
const SECRET_KEY = ['sb', 'secret', 'FAKE0000000000000000'].join('_')

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status })

const tokenAnswer = {
  access_token: ['access', 'new'].join('-'),
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: ['refresh', 'new'].join('-'),
  user: { id: '11111111-2222-4333-8444-555555555555', email: 'ana@example.com' },
}

function harness(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchLike: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body:
        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    }
    calls.push(call)
    return handler(call)
  }
  const resume = vi.fn()
  const halt = vi.fn()
  const deps: ActionDeps = {
    send: createHttp({ fetch: fetchLike }),
    now: () => NOW,
    redirectTo: REDIRECT,
    resume,
    halt,
  }
  return { calls, deps, resume, halt }
}

/** Answers like a healthy project. */
const healthy = (call: Call): Response => {
  if (call.url.endsWith('/auth/v1/settings')) {
    return json(200, { external: { email: true }, disable_signup: false })
  }
  if (call.url.includes('/auth/v1/otp')) return json(200, {})
  if (call.url.includes('/auth/v1/verify') || call.url.includes('grant_type=pkce')) {
    return json(200, tokenAnswer)
  }
  return json(204)
}

/** Reset stops sync on the device and clears everything, which is exactly a clean start. */
beforeEach(resetAllData)
afterEach(resetAllData)

/** The project saved, as "Check connection" leaves it. */
async function saveProject(h: ReturnType<typeof harness>): Promise<void> {
  const saved = await checkAndSaveProject(URL_OK, ANON_KEY, h.deps)
  expect(saved).toEqual({ ok: true })
}

describe('checkAndSaveProject', () => {
  it('saves the project only after the project answers for this key', async () => {
    const h = harness(healthy)
    await expect(checkAndSaveProject(`${URL_OK}/`, ANON_KEY, h.deps)).resolves.toEqual({ ok: true })
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]?.url).toBe(`${URL_OK}/auth/v1/settings`)
    expect(h.calls[0]?.headers.apikey).toBe(ANON_KEY)
    const state = await getSyncState()
    expect(state).toMatchObject({ url: URL_OK, anonKey: ANON_KEY, enabled: false })
    expect(state?.session).toBeNull()
  })

  it('gives each field its own reason and sends nothing for a bad address or key', async () => {
    const h = harness(healthy)
    const result = await checkAndSaveProject('http://localhost:54321', 'not a key', h.deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((i) => i.field)).toEqual(['url', 'key'])
    expect(result.message).toBeNull()
    expect(h.calls).toHaveLength(0)
    expect(await getSyncState()).toBeUndefined()
  })

  it.each([
    ['a service-role key', SECRET_JWT],
    ['a secret key', SECRET_KEY],
  ])('refuses %s with the reason, sends nothing, and keeps nothing', async (_name, key) => {
    const h = harness(healthy)
    const result = await checkAndSaveProject(URL_OK, key, h.deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.message).toContain('must never be put in an app')
    expect(JSON.stringify(result)).not.toContain(key)
    expect(h.calls).toHaveLength(0)
    expect(await getSyncState()).toBeUndefined()
  })

  it('says when email sign-in is switched off, and saves nothing', async () => {
    const h = harness(() => json(200, { external: { email: false } }))
    await expect(checkAndSaveProject(URL_OK, ANON_KEY, h.deps)).resolves.toEqual({
      ok: false,
      issues: [],
      message: EMAIL_OFF_TEXT,
    })
    expect(await getSyncState()).toBeUndefined()
  })

  it('says a wrong key is wrong, without echoing it', async () => {
    const h = harness(() => json(401, { message: 'Invalid API key' }))
    const result = await checkAndSaveProject(URL_OK, ANON_KEY, h.deps)
    expect(result).toMatchObject({ ok: false, issues: [] })
    if (result.ok) return
    expect(result.message).toContain('anon (public) key')
    expect(result.message).not.toContain(ANON_KEY)
    expect(await getSyncState()).toBeUndefined()
  })

  it('says so when the project cannot be reached', async () => {
    const h = harness(() => Promise.reject(new TypeError('Failed to fetch')))
    const result = await checkAndSaveProject(URL_OK, ANON_KEY, h.deps)
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.message).toContain("Can't reach Supabase")
    expect(await getSyncState()).toBeUndefined()
  })
})

describe('sendSignInLink', () => {
  it('needs a saved project and something that looks like an address', async () => {
    const h = harness(healthy)
    await expect(sendSignInLink('ana@example.com', h.deps)).resolves.toEqual({
      ok: false,
      message: NEEDS_PROJECT_TEXT,
    })
    await saveProject(h)
    await expect(sendSignInLink('ana', h.deps)).resolves.toEqual({
      ok: false,
      message: NEEDS_EMAIL_TEXT,
    })
    expect(h.calls.filter((c) => c.url.includes('/otp'))).toHaveLength(0)
  })

  it('asks for a PKCE link that comes back to /settings/sync and remembers how to finish', async () => {
    const h = harness(healthy)
    await saveProject(h)
    await expect(sendSignInLink(' ana@example.com ', h.deps)).resolves.toEqual({ ok: true })
    const otp = h.calls.find((c) => c.url.includes('/auth/v1/otp'))
    expect(otp?.method).toBe('POST')
    expect(new URL(otp?.url ?? '').searchParams.get('redirect_to')).toBe(REDIRECT)
    expect(otp?.body).toMatchObject({
      email: 'ana@example.com',
      create_user: true,
      code_challenge_method: 's256',
    })
    const state = await getSyncState()
    const pending = state?.pendingLogin
    expect(pending).toMatchObject({ email: 'ana@example.com', requestedAt: NOW })
    // The challenge the server got is the S256 of the verifier this device kept.
    const challenge = createHash('sha256')
      .update(pending?.codeVerifier ?? '')
      .digest('base64url')
    expect(otp?.body?.code_challenge).toBe(challenge)
    expect(state?.email).toBe('ana@example.com')
    expect(state?.enabled).toBe(false)
  })

  it('says to wait when Supabase limits its emails, and keeps nothing pending', async () => {
    const h = harness((call) =>
      call.url.includes('/otp')
        ? json(429, { error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' })
        : healthy(call),
    )
    await saveProject(h)
    const result = await sendSignInLink('ana@example.com', h.deps)
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.message).toContain('limits how many sign-in emails')
    expect((await getSyncState())?.pendingLogin).toBeNull()
  })

  it('"Use another email" forgets the request', async () => {
    const h = harness(healthy)
    await saveProject(h)
    await sendSignInLink('ana@example.com', h.deps)
    await forgetPendingLogin()
    expect((await getSyncState())?.pendingLogin).toBeNull()
    expect((await getSyncState())?.url).toBe(URL_OK)
  })
})

describe('signInWithEmailCode', () => {
  it('turns sync on with the code from the email, as a first sync, and starts the engine', async () => {
    const h = harness(healthy)
    await saveProject(h)
    await sendSignInLink('ana@example.com', h.deps)
    await expect(signInWithEmailCode('123 456', h.deps)).resolves.toEqual({ ok: true })
    const verify = h.calls.find((c) => c.url.includes('/auth/v1/verify'))
    expect(verify?.body).toEqual({ type: 'email', email: 'ana@example.com', token: '123456' })
    const state = await getSyncState()
    expect(state).toMatchObject({ enabled: true, phase: 'bootstrap', pendingLogin: null })
    expect(state?.deviceId).toEqual(expect.any(String))
    expect((await getSyncSession())?.userId).toBe(tokenAnswer.user.id)
    expect(syncIsOn()).toBe(true)
    expect(h.resume).toHaveBeenCalledTimes(1)
  })

  it('refuses what is not a code before asking the server', async () => {
    const h = harness(healthy)
    await saveProject(h)
    await sendSignInLink('ana@example.com', h.deps)
    const before = h.calls.length
    await expect(signInWithEmailCode('12ab', h.deps)).resolves.toEqual({
      ok: false,
      message: NEEDS_CODE_TEXT,
    })
    expect(h.calls).toHaveLength(before)
  })

  it('needs an email to have been sent first', async () => {
    const h = harness(healthy)
    await saveProject(h)
    await expect(signInWithEmailCode('123456', h.deps)).resolves.toEqual({
      ok: false,
      message: NEEDS_SEND_TEXT,
    })
  })

  it('an expired code says so and changes nothing', async () => {
    const h = harness((call) =>
      call.url.includes('/verify')
        ? json(403, { error_code: 'otp_expired', msg: 'Token has expired or is invalid' })
        : healthy(call),
    )
    await saveProject(h)
    await sendSignInLink('ana@example.com', h.deps)
    const result = await signInWithEmailCode('654321', h.deps)
    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.message).toContain('expired or was already used')
    expect(await getSyncState()).toMatchObject({ enabled: false })
    expect((await getSyncState())?.pendingLogin).not.toBeNull()
    expect(h.resume).not.toHaveBeenCalled()
  })

  it('signing in again as the same account keeps the device id and does not start over', async () => {
    const h = harness(healthy)
    await saveProject(h)
    await sendSignInLink('ana@example.com', h.deps)
    await signInWithEmailCode('123456', h.deps)
    const first = await getSyncState()
    await sendSignInLink('ana@example.com', h.deps)
    await signInWithEmailCode('123456', h.deps)
    const second = await getSyncState()
    expect(second?.deviceId).toBe(first?.deviceId)
    expect(second?.accountUserId).toBe(first?.accountUserId)
  })
})

describe('exchangeLinkCode', () => {
  it('exchanges the code with the verifier this device kept', async () => {
    const h = harness(healthy)
    await saveProject(h)
    await sendSignInLink('ana@example.com', h.deps)
    const verifier = (await getSyncState())?.pendingLogin?.codeVerifier
    await expect(exchangeLinkCode('3f2b6a9e-51c4-4d6a-9b1e-0c7d2e8a4f10', h.deps)).resolves.toEqual(
      {
        ok: true,
      },
    )
    const exchange = h.calls.find((c) => c.url.includes('grant_type=pkce'))
    expect(exchange?.body).toEqual({
      auth_code: '3f2b6a9e-51c4-4d6a-9b1e-0c7d2e8a4f10',
      code_verifier: verifier,
    })
    expect(await getSyncState()).toMatchObject({ enabled: true, phase: 'bootstrap' })
    expect(h.resume).toHaveBeenCalledTimes(1)
  })

  it('a link opened where it was not requested says so, and asks the server nothing', async () => {
    const h = harness(healthy)
    await saveProject(h)
    const before = h.calls.length
    await expect(exchangeLinkCode('3f2b6a9e-51c4-4d6a-9b1e-0c7d2e8a4f10', h.deps)).resolves.toEqual(
      {
        ok: false,
        message: OTHER_BROWSER_TEXT,
      },
    )
    expect(h.calls).toHaveLength(before)
    expect(h.resume).not.toHaveBeenCalled()
  })

  it('a refused exchange keeps the request, so the code from the email still works', async () => {
    const h = harness((call) =>
      call.url.includes('grant_type=pkce')
        ? json(400, { error_code: 'flow_state_not_found' })
        : healthy(call),
    )
    await saveProject(h)
    await sendSignInLink('ana@example.com', h.deps)
    const result = await exchangeLinkCode('3f2b6a9e-51c4-4d6a-9b1e-0c7d2e8a4f10', h.deps)
    expect(result).toMatchObject({ ok: false })
    expect((await getSyncState())?.pendingLogin).not.toBeNull()
    expect(await getSyncState()).toMatchObject({ enabled: false })
  })

  it('a refused exchange forgets the PKCE verifier (the code field stays); the link then asks the server nothing', async () => {
    const h = harness((call) =>
      call.url.includes('grant_type=pkce')
        ? json(400, { error_code: 'flow_state_not_found' })
        : healthy(call),
    )
    await saveProject(h)
    await sendSignInLink('ana@example.com', h.deps)
    await exchangeLinkCode('3f2b6a9e-51c4-4d6a-9b1e-0c7d2e8a4f10', h.deps)
    const pending = (await getSyncState())?.pendingLogin
    expect(pending?.email).toBe('ana@example.com')
    expect(pending?.codeVerifier).toBe('')
    const before = h.calls.length
    const again = await exchangeLinkCode('9a1c0e2d-51c4-4d6a-9b1e-0c7d2e8a4f10', h.deps)
    expect(again).toEqual({ ok: false, message: linkErrorMessage('otp_expired') })
    expect(h.calls).toHaveLength(before)
  })

  it('an exchange that could not reach the server keeps the verifier, so opening the link again works', async () => {
    let down = true
    const h = harness((call) =>
      call.url.includes('grant_type=pkce') && down ? json(503, {}) : healthy(call),
    )
    await saveProject(h)
    await sendSignInLink('ana@example.com', h.deps)
    const verifier = (await getSyncState())?.pendingLogin?.codeVerifier
    await expect(
      exchangeLinkCode('3f2b6a9e-51c4-4d6a-9b1e-0c7d2e8a4f10', h.deps),
    ).resolves.toMatchObject({ ok: false })
    expect((await getSyncState())?.pendingLogin?.codeVerifier).toBe(verifier)
    down = false
    await expect(exchangeLinkCode('3f2b6a9e-51c4-4d6a-9b1e-0c7d2e8a4f10', h.deps)).resolves.toEqual(
      {
        ok: true,
      },
    )
  })
})

describe('signOutAndStop', () => {
  async function signedIn() {
    const h = harness(healthy)
    await saveProject(h)
    await sendSignInLink('ana@example.com', h.deps)
    await signInWithEmailCode('123456', h.deps)
    return h
  }

  it('stops syncing on this device, keeps the project and the email, and ends the session', async () => {
    const h = await signedIn()
    // A change waiting to sync is forgotten with the rest of the bookkeeping; the data stays.
    await createTask({ title: 'C182 unit 1: networks and the internet' })
    expect(await pendingChangeCount()).toBeGreaterThan(0)
    await expect(signOutAndStop(h.deps)).resolves.toEqual({ ok: true })
    expect(h.halt).toHaveBeenCalledTimes(1)
    const state = await getSyncState()
    expect(state).toMatchObject({
      enabled: false,
      url: URL_OK,
      anonKey: ANON_KEY,
      email: 'ana@example.com',
      session: null,
      phase: 'off',
      deviceId: null,
    })
    expect(await pendingChangeCount()).toBe(0)
    expect(syncIsOn()).toBe(false)
    await vi.waitFor(() => {
      const logout = h.calls.find((c) => c.url.includes('/auth/v1/logout'))
      expect(logout?.url).toContain('scope=local')
      expect(logout?.headers.Authorization).toBe(`Bearer ${tokenAnswer.access_token}`)
    })
  })

  it('signs out even when the server cannot be reached', async () => {
    const h = await signedIn()
    const offline = harness(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(
      signOutAndStop({ ...h.deps, send: offline.deps.send, halt: h.halt }),
    ).resolves.toEqual({
      ok: true,
    })
    expect(await getSyncState()).toMatchObject({ enabled: false, session: null })
  })

  it('is fine when nothing was ever set up', async () => {
    const h = harness(healthy)
    await expect(signOutAndStop(h.deps)).resolves.toEqual({ ok: true })
    expect(h.calls).toHaveLength(0)
  })
})
