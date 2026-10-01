import { afterEach, describe, expect, it, vi } from 'vitest'
import { SyncTransportError } from '@/logic/sync'
import {
  logoutRequest,
  otpRequest,
  pullRequest,
  pushRequest,
  refreshRequest,
  serverTimeRequest,
  settingsRequest,
  userRequest,
  verifyRequest,
  type HttpRequest,
  type TransportConfig,
} from '@/logic/syncRequests'
import {
  createHttp,
  PAUSED_MESSAGE,
  SupabaseError,
  suggestsPaused,
  type FailureReason,
  type FetchLike,
} from './http'

// A legacy anon JWT, built at run time: no secret-shaped literal in the repo.
const KEY = ['eyJhbGciOiJIUzI1NiJ9', 'eyJyb2xlIjoiYW5vbiJ9', 'c2lnbmF0dXJl'].join('.')
const ACCESS = 'access.token.SECRET-ACCESS'
const REFRESH = 'SECRET-REFRESH-TOKEN'
const config: TransportConfig = {
  url: 'https://abcdefghijklmnopqrst.supabase.co',
  anonKey: KEY,
  keyKind: 'anonJwt',
}
const session = { accessToken: ACCESS, userId: 'user-0001' }

const R = {
  settings: settingsRequest(config),
  otp: otpRequest(config, { email: 'ana@example.com', redirectTo: '', codeChallenge: 'c' }),
  verify: verifyRequest(config, { email: 'ana@example.com', code: '123456' }),
  refresh: refreshRequest(config, REFRESH),
  user: userRequest(config, session),
  logout: logoutRequest(config, session),
  serverTime: serverTimeRequest(config, session),
  pull: pullRequest(config, session, 0, 500),
  push: pushRequest(config, session, [
    {
      tbl: 'tasks',
      id: 't1',
      updatedAt: 1,
      deviceId: 'd',
      deleted: false,
      schemaVersion: 3,
      data: { id: 't1' },
    },
  ]),
}

interface Call {
  url: string
  init: RequestInit
}
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

function fake(handler: Handler): FetchLike & { calls: Call[] } {
  const calls: Call[] = []
  const fn: FetchLike = (url, init) => {
    calls.push({ url, init })
    return Promise.resolve(handler(url, init))
  }
  return Object.assign(fn, { calls })
}

const reply = (status: number, body?: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers,
  })

/** The error a request fails with. */
async function failure(
  req: HttpRequest,
  response: Response | Error,
  opts: { isOnline?: () => boolean; now?: () => number } = {},
): Promise<SupabaseError> {
  const send = createHttp({
    fetch: fake(() => {
      if (response instanceof Error) throw response
      return response
    }),
    ...opts,
  })
  const error = await send(req).then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(SupabaseError)
  return error as SupabaseError
}

afterEach(() => vi.useRealTimers())

describe('createHttp: sending', () => {
  it('passes the described request to fetch, omitting cookies and the cache', async () => {
    const f = fake(() => reply(201))
    await createHttp({ fetch: f })(R.push)
    expect(f.calls).toHaveLength(1)
    const { url, init } = f.calls[0] as Call
    expect(url).toBe(R.push.url)
    expect(init).toMatchObject({
      method: 'POST',
      headers: R.push.headers,
      body: R.push.body,
      keepalive: false,
      credentials: 'omit',
      cache: 'no-store',
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends a GET without a body, and keepalive when the request asks for it', async () => {
    const f = fake(() => reply(200, []))
    const send = createHttp({ fetch: f })
    await send(R.pull)
    await send({ ...R.push, keepalive: true })
    expect((f.calls[0] as Call).init.body).toBeUndefined()
    expect((f.calls[0] as Call).init.keepalive).toBe(false)
    expect((f.calls[1] as Call).init.keepalive).toBe(true)
  })

  it('returns the parsed JSON body', async () => {
    const send = createHttp({ fetch: fake(() => reply(200, { access_token: 'a', n: [1, 2] })) })
    expect(await send(R.verify)).toEqual({ access_token: 'a', n: [1, 2] })
  })

  it('returns null for an answer with no body (201 push, 204 logout)', async () => {
    expect(await createHttp({ fetch: fake(() => reply(201)) })(R.push)).toBeNull()
    expect(await createHttp({ fetch: fake(() => reply(204)) })(R.logout)).toBeNull()
  })

  it('returns a bare JSON number (forge_now)', async () => {
    expect(await createHttp({ fetch: fake(() => reply(200, '1780000000123')) })(R.serverTime)).toBe(
      1_780_000_000_123,
    )
  })

  it('does not change the request it is given', async () => {
    const before = JSON.stringify(R.push)
    await createHttp({ fetch: fake(() => reply(201)) })(R.push)
    expect(JSON.stringify(R.push)).toBe(before)
  })

  it('does not retry: one call, one fetch, whatever the answer', async () => {
    for (const response of [reply(500), reply(429), reply(401), new TypeError('Failed to fetch')]) {
      const f = fake(() => {
        if (response instanceof Error) throw response
        return response.clone()
      })
      await createHttp({ fetch: f })(R.pull).catch(() => undefined)
      expect(f.calls).toHaveLength(1)
    }
  })
})

describe('createHttp: mapping failures', () => {
  interface Case {
    name: string
    req: HttpRequest
    res: Response
    reason: FailureReason
    kind: SupabaseError['kind']
    code?: string | null
    text?: RegExp
  }
  const cases: Case[] = [
    // 4xx: the caller did something the server refused
    {
      name: '400 refresh (no code)',
      req: R.refresh,
      res: reply(400, { msg: 'x' }),
      reason: 'unauthorized',
      kind: 'signedOut',
    },
    {
      name: '400 refresh invalid_grant',
      req: R.refresh,
      res: reply(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }),
      reason: 'unauthorized',
      kind: 'signedOut',
      code: 'invalid_grant',
    },
    {
      name: '400 PostgREST bad request',
      req: R.pull,
      res: reply(400, { code: 'PGRST100', message: 'x' }),
      reason: 'rejected',
      kind: 'server',
      code: 'PGRST100',
    },
    {
      name: '400 sign-in validation',
      req: R.otp,
      res: reply(400, { code: 'validation_failed', msg: 'x' }),
      reason: 'rejected',
      kind: 'server',
      code: 'validation_failed',
    },
    {
      name: '400 bad email',
      req: R.otp,
      res: reply(400, { code: 'email_address_invalid' }),
      reason: 'rejected',
      kind: 'server',
      code: 'email_address_invalid',
      text: /email address/,
    },
    // 401: expired or invalid session, or a bad key
    {
      name: '401 expired JWT on a data call',
      req: R.pull,
      res: reply(401, { code: 'PGRST301', message: 'JWT expired' }),
      reason: 'unauthorized',
      kind: 'signedOut',
      code: 'PGRST301',
    },
    {
      name: '401 bad_jwt on the user call',
      req: R.user,
      res: reply(401, { code: 'bad_jwt', msg: 'invalid JWT' }),
      reason: 'unauthorized',
      kind: 'signedOut',
      code: 'bad_jwt',
    },
    {
      name: '401 refresh token not found',
      req: R.refresh,
      res: reply(401, { code: 'refresh_token_not_found' }),
      reason: 'unauthorized',
      kind: 'signedOut',
      code: 'refresh_token_not_found',
    },
    {
      name: '401 the gateway names the key',
      req: R.pull,
      res: reply(401, { message: 'Invalid API key', hint: 'Double check your key' }),
      reason: 'badKey',
      kind: 'signedOut',
      text: /anon \(public\) key/,
    },
    {
      name: '401 on Check connection',
      req: R.settings,
      res: reply(401, { message: 'No API key found in request' }),
      reason: 'badKey',
      kind: 'signedOut',
    },
    {
      name: '401 on Check connection, empty body',
      req: R.settings,
      res: reply(401),
      reason: 'badKey',
      kind: 'signedOut',
    },
    {
      name: '401 on sending the link',
      req: R.otp,
      res: reply(401, { msg: 'x' }),
      reason: 'badKey',
      kind: 'signedOut',
    },
    // 403: an expired code or link (auth) versus missing policies (data)
    {
      name: '403 expired code',
      req: R.verify,
      res: reply(403, { code: 403, error_code: 'otp_expired', msg: 'x' }),
      reason: 'unauthorized',
      kind: 'signedOut',
      code: 'otp_expired',
      text: /expired/,
    },
    {
      name: '403 expired link flow',
      req: R.verify,
      res: reply(403, { code: 'flow_state_expired' }),
      reason: 'unauthorized',
      kind: 'signedOut',
      code: 'flow_state_expired',
    },
    {
      name: '403 on logout',
      req: R.logout,
      res: reply(403, { code: 'session_not_found' }),
      reason: 'unauthorized',
      kind: 'signedOut',
      code: 'session_not_found',
    },
    {
      name: '403 missing policies on pull',
      req: R.pull,
      res: reply(403, { code: '42501', message: 'permission denied for table forge_rows' }),
      reason: 'forbidden',
      kind: 'forbidden',
      code: '42501',
    },
    {
      name: '403 row-level security on push',
      req: R.push,
      res: reply(403, { code: '42501', message: 'new row violates row-level security policy' }),
      reason: 'forbidden',
      kind: 'forbidden',
      code: '42501',
    },
    {
      name: '403 with no code on push',
      req: R.push,
      res: reply(403),
      reason: 'forbidden',
      kind: 'forbidden',
    },
    // 404: setup missing
    {
      name: '404 table missing',
      req: R.pull,
      res: reply(404, { code: 'PGRST205', message: 'x' }),
      reason: 'setup',
      kind: 'setup',
      code: 'PGRST205',
    },
    {
      name: '404 forge_now missing',
      req: R.serverTime,
      res: reply(404, { code: 'PGRST202', message: 'x' }),
      reason: 'setup',
      kind: 'setup',
      code: 'PGRST202',
    },
    {
      name: '404 relation missing (42P01)',
      req: R.push,
      res: reply(404, { code: '42P01', message: 'x' }),
      reason: 'setup',
      kind: 'setup',
      code: '42P01',
    },
    {
      name: '404 link not started here',
      req: R.verify,
      res: reply(404, { code: 'flow_state_not_found' }),
      reason: 'rejected',
      kind: 'server',
      code: 'flow_state_not_found',
      text: /not started here/,
    },
    { name: '404 with no code', req: R.pull, res: reply(404), reason: 'rejected', kind: 'server' },
    // other 4xx
    {
      name: '409 conflict',
      req: R.push,
      res: reply(409, { code: '23505', message: 'x' }),
      reason: 'rejected',
      kind: 'server',
      code: '23505',
    },
    {
      name: '413 too large',
      req: R.push,
      res: reply(413, 'Payload Too Large'),
      reason: 'tooLarge',
      kind: 'tooLarge',
    },
    {
      name: '422 sign-ups closed',
      req: R.otp,
      res: reply(422, { code: 'signup_disabled', msg: 'Signups not allowed for otp' }),
      reason: 'rejected',
      kind: 'server',
      code: 'signup_disabled',
      text: /new accounts/,
    },
    // 429
    {
      name: '429 email rate limit',
      req: R.otp,
      res: reply(429, { code: 'over_email_send_rate_limit' }),
      reason: 'rateLimited',
      kind: 'rateLimited',
      code: 'over_email_send_rate_limit',
      text: /Wait a little/,
    },
    {
      name: '429 request rate limit',
      req: R.pull,
      res: reply(429, { code: 'over_request_rate_limit' }),
      reason: 'rateLimited',
      kind: 'rateLimited',
      code: 'over_request_rate_limit',
    },
    {
      name: '429 with no body',
      req: R.push,
      res: reply(429),
      reason: 'rateLimited',
      kind: 'rateLimited',
    },
    // 5xx
    {
      name: '500',
      req: R.pull,
      res: reply(500, { code: 'XX000', message: 'x' }),
      reason: 'unavailable',
      kind: 'server',
      code: 'XX000',
      text: /try again/,
    },
    {
      name: '502 with an HTML page',
      req: R.pull,
      res: reply(502, '<html>Bad Gateway</html>'),
      reason: 'unavailable',
      kind: 'server',
    },
    { name: '503', req: R.push, res: reply(503), reason: 'unavailable', kind: 'server' },
    { name: '504', req: R.pull, res: reply(504), reason: 'unavailable', kind: 'server' },
    {
      name: '520',
      req: R.pull,
      res: reply(520),
      reason: 'unavailable',
      kind: 'server',
      text: /isn't answering/,
    },
    {
      name: '522',
      req: R.settings,
      res: reply(522),
      reason: 'unavailable',
      kind: 'server',
      text: /isn't answering/,
    },
    {
      name: '540 paused project',
      req: R.pull,
      res: reply(540, 'Project paused'),
      reason: 'unavailable',
      kind: 'server',
      text: /isn't answering/,
    },
    // an answer that cannot be used
    {
      name: '200 that is not JSON',
      req: R.verify,
      res: reply(200, '<html>hello</html>'),
      reason: 'rejected',
      kind: 'server',
      text: /didn't expect/,
    },
  ]

  for (const c of cases) {
    it(c.name, async () => {
      const error = await failure(c.req, c.res)
      expect(error.reason).toBe(c.reason)
      expect(error.kind).toBe(c.kind)
      expect(error.status).toBe(c.res.status)
      expect(error.code).toBe(c.code ?? null)
      expect(error.retryAfterMs).toBeNull()
      expect(error.message).not.toBe('')
      if (c.text !== undefined) expect(error.message).toMatch(c.text)
    })
  }

  it('keeps calm, distinct wording for a bad key and a plain outage', async () => {
    const badKey = await failure(R.settings, reply(401))
    const down = await failure(R.pull, reply(503))
    expect(badKey.message).not.toBe(down.message)
  })

  it('never calls a project paused on one answer: 520 to 540 read like any outage', async () => {
    // One 52x is also what a short origin hiccup looks like (PLAN 4.7.7 says "repeated 5xx").
    const plain = (await failure(R.pull, reply(503))).message
    for (const status of [520, 522, 526, 540]) {
      const error = await failure(R.pull, reply(status))
      expect(error.message, String(status)).toBe(plain)
      expect(error.message, String(status)).not.toBe(PAUSED_MESSAGE)
      expect(error.status).toBe(status)
    }
  })

  it('marks the outages that fit a paused project, for the engine to count', async () => {
    expect(PAUSED_MESSAGE).toContain('Supabase dashboard')
    for (const status of [520, 522, 526, 540]) {
      expect(suggestsPaused(await failure(R.pull, reply(status))), String(status)).toBe(true)
    }
    for (const status of [500, 502, 503, 504]) {
      expect(suggestsPaused(await failure(R.pull, reply(status))), String(status)).toBe(false)
    }
    // Not an outage, or no answer at all.
    expect(suggestsPaused(await failure(R.pull, reply(401)))).toBe(false)
    expect(suggestsPaused(await failure(R.pull, reply(429)))).toBe(false)
    expect(suggestsPaused(await failure(R.pull, new TypeError('Failed to fetch')))).toBe(false)
  })

  it('never mistakes a server-supplied code for a message key (constructor, __proto__, toString)', async () => {
    for (const code of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const error = await failure(R.otp, reply(400, { code }))
      expect(error.message, code).toBe('Supabase refused the request.')
      expect(error.code, code).toBe(code)
    }
  })

  it('is a SyncTransportError, so the engine and the fake server share one type', async () => {
    const error = await failure(R.pull, reply(503))
    expect(error).toBeInstanceOf(SyncTransportError)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('SupabaseError')
  })

  describe('429 and Retry-After', () => {
    it('reads seconds', async () => {
      const error = await failure(R.push, reply(429, undefined, { 'Retry-After': '30' }))
      expect(error).toMatchObject({ reason: 'rateLimited', status: 429, retryAfterMs: 30_000 })
    })

    it('reads an HTTP date against the injected clock', async () => {
      const now = Date.parse('2026-09-30T12:00:00Z')
      const error = await failure(
        R.push,
        reply(429, undefined, { 'Retry-After': 'Wed, 30 Sep 2026 12:02:00 GMT' }),
        { now: () => now },
      )
      expect(error.retryAfterMs).toBe(120_000)
    })

    it('is null when the header is missing or unreadable', async () => {
      expect((await failure(R.push, reply(429))).retryAfterMs).toBeNull()
      expect(
        (await failure(R.push, reply(429, undefined, { 'Retry-After': 'soon' }))).retryAfterMs,
      ).toBeNull()
    })

    it('is ignored on other statuses', async () => {
      const error = await failure(R.push, reply(503, undefined, { 'Retry-After': '30' }))
      expect(error.retryAfterMs).toBeNull()
    })
  })

  describe('no response', () => {
    it('is offline when fetch rejects, online or not', async () => {
      for (const online of [true, false]) {
        const error = await failure(R.pull, new TypeError('Failed to fetch'), {
          isOnline: () => online,
        })
        expect(error).toMatchObject({
          reason: 'offline',
          kind: 'offline',
          status: null,
          code: null,
        })
        expect(error.message).toMatch(/internet connection/)
      }
    })

    it('is offline when reading the body fails half way', async () => {
      const cut = {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.reject(new TypeError('network error')),
      } as unknown as Response
      const error = await failure(R.pull, cut)
      expect(error).toMatchObject({ reason: 'offline', kind: 'offline', status: null })
    })
  })
})

describe('createHttp: timeouts', () => {
  /** A fetch that never answers, but honours the abort signal like the real one. */
  const hang: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      )
    })

  it('gives up after 20 s by default, as a server-side outage to back off from', async () => {
    vi.useFakeTimers()
    const settled = vi.fn()
    const pending = createHttp({ fetch: hang })(R.pull).catch((e: unknown) => {
      settled()
      return e
    })
    await vi.advanceTimersByTimeAsync(19_999)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    const error = (await pending) as SupabaseError
    expect(error).toMatchObject({ reason: 'unavailable', kind: 'server', status: null })
    expect(error.message).toMatch(/too long/)
  })

  it('honours a custom limit', async () => {
    vi.useFakeTimers()
    const pending = createHttp({ fetch: hang, timeoutMs: 1_000 })(R.push).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await pending).toMatchObject({ reason: 'unavailable', kind: 'server' })
  })

  it('also covers a body that never finishes arriving', async () => {
    vi.useFakeTimers()
    const stuck: FetchLike = (_url, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () =>
          new Promise<string>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('x', 'AbortError')),
            )
          }),
      } as unknown as Response)
    const pending = createHttp({ fetch: stuck, timeoutMs: 500 })(R.pull).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(500)
    expect(await pending).toMatchObject({ reason: 'unavailable', kind: 'server' })
  })

  it('leaves no timer behind, on success or on failure', async () => {
    vi.useFakeTimers()
    await createHttp({ fetch: fake(() => reply(200, [])) })(R.pull)
    expect(vi.getTimerCount()).toBe(0)
    await createHttp({ fetch: fake(() => reply(503)) })(R.pull).catch(() => undefined)
    expect(vi.getTimerCount()).toBe(0)
    await createHttp({ fetch: fake(() => Promise.reject(new TypeError('x'))) })(R.pull).catch(
      () => undefined,
    )
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('createHttp: secrets', () => {
  const SECRETS = [ACCESS, REFRESH, KEY, 'ana@example.com']

  /** Everything an error could show someone: text, fields, JSON, stack, enumerable and not. */
  function exposed(error: Error): string {
    return [
      String(error),
      error.message,
      error.stack ?? '',
      JSON.stringify(error),
      Object.getOwnPropertyNames(error)
        .map((k) => `${k}=${String(Reflect.get(error, k))}`)
        .join('\n'),
      String((error as { cause?: unknown }).cause),
    ].join('\n')
  }

  it('never puts a token, key or email in an error, even when the server echoes them', async () => {
    const echo = { message: `JWT expired: ${ACCESS} ${REFRESH} ${KEY} ana@example.com`, hint: KEY }
    const attempts: [HttpRequest, Response | Error][] = [
      [R.pull, reply(401, echo)],
      [R.push, reply(403, { code: '42501', ...echo })],
      [R.refresh, reply(400, { error: 'invalid_grant', error_description: echo.message })],
      [R.settings, reply(401, echo)],
      [R.otp, reply(429, { code: 'over_email_send_rate_limit', ...echo })],
      [R.pull, reply(500, echo)],
      [R.pull, reply(200, `not json ${ACCESS}`)],
      [R.pull, new TypeError(`Failed to fetch ${R.pull.url} ${ACCESS}`)],
    ]
    for (const [req, res] of attempts) {
      const error = await failure(req, res)
      const text = exposed(error)
      for (const secret of SECRETS) expect(text, `${req.op} leaks ${secret}`).not.toContain(secret)
      expect(text).not.toContain(req.url)
    }
  })

  it('never logs: nothing is written to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    await failure(R.pull, reply(401, { message: ACCESS }))
    await failure(R.pull, new TypeError('offline'))
    await createHttp({ fetch: fake(() => reply(200, [])) })(R.pull)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})
