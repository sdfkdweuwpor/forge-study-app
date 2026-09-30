import { describe, expect, it } from 'vitest'
import type { SyncSession } from '@/db/types'
import type { PushRow } from './sync'
import { KEY_KINDS, type KeyKind } from './syncConfig'
import {
  API_VERSION,
  errorDetail,
  logoutRequest,
  otpRequest,
  parsePullRows,
  parseServerTime,
  parseSession,
  parseSettings,
  parseUser,
  pkceRequest,
  PULL_COLUMNS,
  pullRequest,
  pushRequest,
  refreshRequest,
  serverTimeRequest,
  settingsRequest,
  userRequest,
  verifyRequest,
  type HttpRequest,
  type RequestOp,
  type SessionAuth,
  type TransportConfig,
} from './syncRequests'

const URL_OK = 'https://abcdefghijklmnopqrst.supabase.co'
const ANON_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln'
const PUBLISHABLE = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
const KEYS: Record<KeyKind, string> = { anonJwt: ANON_JWT, publishable: PUBLISHABLE }
const config = (keyKind: KeyKind): TransportConfig => ({
  url: URL_OK,
  anonKey: KEYS[keyKind],
  keyKind,
})
const SESSION: SessionAuth = { accessToken: 'access.token.value', userId: 'user-0001' }

function every(kind: KeyKind): Record<RequestOp, HttpRequest> {
  const c = config(kind)
  return {
    settings: settingsRequest(c),
    otp: otpRequest(c, { email: 'ana@example.com', redirectTo: '', codeChallenge: 'chal' }),
    pkce: pkceRequest(c, { authCode: 'code', codeVerifier: 'verifier' }),
    verify: verifyRequest(c, { email: 'ana@example.com', code: '123456' }),
    refresh: refreshRequest(c, 'refresh-token'),
    user: userRequest(c, SESSION),
    logout: logoutRequest(c, SESSION),
    serverTime: serverTimeRequest(c, SESSION),
    pull: pullRequest(c, SESSION, 0, 500),
    push: pushRequest(c, SESSION, []),
  }
}

const AUTH_OPS: readonly RequestOp[] = [
  'settings',
  'otp',
  'pkce',
  'verify',
  'refresh',
  'user',
  'logout',
]
const SIGNED_IN_OPS: readonly RequestOp[] = ['user', 'logout', 'serverTime', 'pull', 'push']
const body = (r: HttpRequest): unknown => (r.body === null ? null : JSON.parse(r.body))

const row = (over: Partial<PushRow> = {}): PushRow => ({
  tbl: 'tasks',
  id: 'task-1',
  updatedAt: 1_780_000_000_000,
  deviceId: 'device-a',
  deleted: false,
  schemaVersion: 3,
  data: { id: 'task-1', title: 'Finish C182 unit 2 notes' },
  ...over,
})

describe('headers per key kind', () => {
  for (const kind of KEY_KINDS) {
    describe(kind, () => {
      const requests = Object.entries(every(kind)) as [RequestOp, HttpRequest][]

      it('sends apikey and a JSON content type on every call', () => {
        for (const [op, r] of requests) {
          expect(r.headers.apikey, op).toBe(KEYS[kind])
          expect(r.headers['Content-Type'], op).toBe('application/json')
        }
      })

      it('sends the access token as the bearer on signed-in calls', () => {
        for (const op of SIGNED_IN_OPS) {
          const r = every(kind)[op]
          expect(r.headers.Authorization, op).toBe(`Bearer ${SESSION.accessToken}`)
          expect(r.session, op).toBe(true)
        }
      })

      it('never sends the anon key as a bearer once signed in', () => {
        for (const op of SIGNED_IN_OPS) {
          expect(every(kind)[op].headers.Authorization, op).not.toContain(KEYS[kind])
        }
      })

      it('adds the GoTrue API version to auth calls and only to those', () => {
        for (const [op, r] of requests) {
          if (AUTH_OPS.includes(op))
            expect(r.headers['X-Supabase-Api-Version'], op).toBe(API_VERSION)
          else expect(r.headers['X-Supabase-Api-Version'], op).toBeUndefined()
        }
      })

      it('never puts a token or key in a URL', () => {
        for (const [op, r] of requests) {
          expect(r.url, op).not.toContain(KEYS[kind])
          expect(r.url, op).not.toContain(SESSION.accessToken)
          expect(r.url, op).not.toContain('refresh-token')
        }
      })
    })
  }

  it('uses a legacy anon JWT as the bearer before sign-in', () => {
    const r = every('anonJwt')
    for (const op of ['settings', 'otp', 'pkce', 'verify', 'refresh'] as const) {
      expect(r[op].headers.Authorization, op).toBe(`Bearer ${ANON_JWT}`)
      expect(r[op].session, op).toBe(false)
    }
  })

  it('never sends an sb_publishable_ key as a bearer', () => {
    const r = every('publishable')
    for (const op of ['settings', 'otp', 'pkce', 'verify', 'refresh'] as const) {
      expect(r[op].headers, op).not.toHaveProperty('Authorization')
      expect(r[op].session, op).toBe(false)
    }
    for (const request of Object.values(r)) {
      expect(Object.values(request.headers)).not.toContain(`Bearer ${PUBLISHABLE}`)
    }
  })

  it('refreshes with the anon bearer (or none), never with an access token', () => {
    const anon = refreshRequest(config('anonJwt'), 'rt')
    expect(anon.headers.Authorization).toBe(`Bearer ${ANON_JWT}`)
    expect(anon.session).toBe(false)
    expect(refreshRequest(config('publishable'), 'rt').headers).not.toHaveProperty('Authorization')
  })

  it('adds Prefer only to the push', () => {
    const r = every('anonJwt')
    for (const [op, request] of Object.entries(r)) {
      if (op === 'push') {
        expect(request.headers.Prefer).toBe('resolution=merge-duplicates,return=minimal')
      } else expect(request.headers, op).not.toHaveProperty('Prefer')
    }
  })
})

describe('GoTrue requests', () => {
  const c = config('anonJwt')

  it('checks the project with a GET to /auth/v1/settings', () => {
    expect(settingsRequest(c)).toMatchObject({
      op: 'settings',
      method: 'GET',
      url: `${URL_OK}/auth/v1/settings`,
      body: null,
      keepalive: false,
    })
  })

  it('sends the sign-in email with the PKCE challenge and an encoded redirect', () => {
    const r = otpRequest(c, {
      email: '  ana@example.com ',
      redirectTo: 'https://forge-study-app.netlify.app/settings/sync',
      codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    })
    expect(r.method).toBe('POST')
    expect(r.url).toBe(
      `${URL_OK}/auth/v1/otp?redirect_to=https%3A%2F%2Fforge-study-app.netlify.app%2Fsettings%2Fsync`,
    )
    expect(body(r)).toEqual({
      email: 'ana@example.com',
      create_user: true,
      data: {},
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 's256',
    })
  })

  it('leaves redirect_to out when there is none, and encodes awkward ones whole', () => {
    expect(otpRequest(c, { email: 'a@b.co', redirectTo: '', codeChallenge: 'x' }).url).toBe(
      `${URL_OK}/auth/v1/otp`,
    )
    const url = otpRequest(c, {
      email: 'a@b.co',
      redirectTo: 'http://localhost:5173/settings/sync?a=1&b=2#x',
      codeChallenge: 'x',
    }).url
    expect(new URL(url).searchParams.get('redirect_to')).toBe(
      'http://localhost:5173/settings/sync?a=1&b=2#x',
    )
  })

  it('exchanges the PKCE code', () => {
    const r = pkceRequest(c, { authCode: 'abc-123', codeVerifier: 'v'.repeat(64) })
    expect(r.method).toBe('POST')
    expect(r.url).toBe(`${URL_OK}/auth/v1/token?grant_type=pkce`)
    expect(body(r)).toEqual({ auth_code: 'abc-123', code_verifier: 'v'.repeat(64) })
  })

  it('verifies the emailed code as type "email", dropping spaces', () => {
    const r = verifyRequest(c, { email: ' ana@example.com', code: '123 456\n' })
    expect(r.url).toBe(`${URL_OK}/auth/v1/verify`)
    expect(body(r)).toEqual({ type: 'email', email: 'ana@example.com', token: '123456' })
  })

  it('refreshes with the refresh token only', () => {
    const r = refreshRequest(c, 'rt-1')
    expect(r.url).toBe(`${URL_OK}/auth/v1/token?grant_type=refresh_token`)
    expect(body(r)).toEqual({ refresh_token: 'rt-1' })
  })

  it('gets the user and signs out locally, both with the session bearer', () => {
    expect(userRequest(c, SESSION)).toMatchObject({
      method: 'GET',
      url: `${URL_OK}/auth/v1/user`,
      body: null,
    })
    expect(logoutRequest(c, SESSION)).toMatchObject({
      method: 'POST',
      url: `${URL_OK}/auth/v1/logout?scope=local`,
      body: null,
    })
  })

  it('tolerates a trailing slash on the base URL', () => {
    expect(settingsRequest({ ...c, url: `${URL_OK}/` }).url).toBe(`${URL_OK}/auth/v1/settings`)
  })
})

describe('PostgREST requests', () => {
  const c = config('publishable')

  it('asks the server clock with an empty JSON object', () => {
    const r = serverTimeRequest(c, SESSION)
    expect(r.method).toBe('POST')
    expect(r.url).toBe(`${URL_OK}/rest/v1/rpc/forge_now`)
    expect(body(r)).toEqual({})
  })

  it('pulls rows after the cursor, oldest first, one page', () => {
    const r = pullRequest(c, SESSION, 1234, 500)
    expect(r.method).toBe('GET')
    expect(r.body).toBeNull()
    expect(r.url).toBe(
      `${URL_OK}/rest/v1/forge_rows?select=${PULL_COLUMNS}&seq=gt.1234&order=seq.asc&limit=500`,
    )
    expect(PULL_COLUMNS.split(',')).toEqual([
      'tbl',
      'id',
      'updated_at',
      'device_id',
      'deleted',
      'schema_version',
      'data',
      'seq',
    ])
  })

  it('starts a first sync from cursor 0 and takes a cursor past 2^31', () => {
    expect(pullRequest(c, SESSION, 0, 500).url).toContain('seq=gt.0&')
    expect(pullRequest(c, SESSION, 5_000_000_000, 50).url).toContain('seq=gt.5000000000&')
  })

  it('refuses a cursor or page size that is not a whole number', () => {
    for (const bad of [-1, 1.5, Number.NaN, Infinity]) {
      expect(() => pullRequest(c, SESSION, bad, 500), String(bad)).toThrow(RangeError)
    }
    for (const bad of [0, -5, 2.5, Number.NaN]) {
      expect(() => pullRequest(c, SESSION, 0, bad), String(bad)).toThrow(RangeError)
    }
  })

  it('pushes an upsert keyed on user_id, tbl, id', () => {
    const r = pushRequest(c, SESSION, [row()])
    expect(r.method).toBe('POST')
    expect(r.url).toBe(`${URL_OK}/rest/v1/forge_rows?on_conflict=user_id,tbl,id`)
    expect(r.headers.Prefer).toBe('resolution=merge-duplicates,return=minimal')
    expect(body(r)).toEqual([
      {
        user_id: 'user-0001',
        tbl: 'tasks',
        id: 'task-1',
        updated_at: 1_780_000_000_000,
        device_id: 'device-a',
        deleted: false,
        schema_version: 3,
        data: { id: 'task-1', title: 'Finish C182 unit 2 notes' },
      },
    ])
  })

  it('gives every object the same keys in the same order, tombstones included', () => {
    const rows = [
      row(),
      row({ id: 'task-2', deleted: true, data: null }),
      row({ tbl: 'goals', id: 'goal-1', data: { id: 'goal-1', title: 'WGU BSSD' } }),
      row({ id: 'task-3', data: undefined }),
    ]
    const sent = body(pushRequest(c, SESSION, rows)) as Record<string, unknown>[]
    const keys = Object.keys(sent[0] ?? {})
    expect(keys).toEqual([
      'user_id',
      'tbl',
      'id',
      'updated_at',
      'device_id',
      'deleted',
      'schema_version',
      'data',
    ])
    for (const object of sent) expect(Object.keys(object)).toEqual(keys)
    expect(sent[1]).toMatchObject({ deleted: true, data: null })
    expect(sent[3]).toMatchObject({ data: null })
  })

  it('takes user_id from the session, keeps the order given, and does not touch its input', () => {
    const rows = [row({ id: 'b' }), row({ id: 'a' }), row({ id: 'c' })]
    const before = JSON.stringify(rows)
    const sent = body(pushRequest(c, { ...SESSION, userId: 'user-9' }, rows)) as {
      user_id: string
      id: string
    }[]
    expect(sent.map((r) => r.id)).toEqual(['b', 'a', 'c'])
    expect(new Set(sent.map((r) => r.user_id))).toEqual(new Set(['user-9']))
    expect(JSON.stringify(rows)).toBe(before)
  })

  it('marks a push as keepalive only when asked', () => {
    expect(pushRequest(c, SESSION, [row()]).keepalive).toBe(false)
    expect(pushRequest(c, SESSION, [row()], { keepalive: true }).keepalive).toBe(true)
    expect(pullRequest(c, SESSION, 0, 500).keepalive).toBe(false)
  })

  it('is idempotent at the request level: the same rows always make the same bytes', () => {
    const rows = [row(), row({ id: 'task-2', deleted: true, data: null })]
    const first = pushRequest(c, SESSION, rows)
    const again = pushRequest(
      c,
      SESSION,
      rows.map((r) => ({ ...r })),
    )
    expect(again).toEqual(first)
    expect(again.body).toBe(first.body)
    // Nothing time- or randomness-dependent leaks into a request: no id, no timestamp header.
    expect(Object.keys(first.headers).sort()).toEqual(
      ['Authorization', 'Content-Type', 'Prefer', 'apikey'].sort(),
    )
  })
})

describe('parseSession', () => {
  const answer = {
    access_token: 'at-1',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 1_780_003_600,
    refresh_token: 'rt-1',
    user: { id: 'user-0001', email: 'ana@example.com', aud: 'authenticated' },
  }

  it('counts expires_in from the time of the request, in milliseconds', () => {
    expect(parseSession(answer, 1_780_000_000_000)).toEqual({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt: 1_780_000_000_000 + 3_600_000,
      userId: 'user-0001',
      email: 'ana@example.com',
    } satisfies SyncSession)
  })

  it("falls back to the server's expires_at (seconds) when expires_in is missing", () => {
    const { expires_in: _unused, ...rest } = answer
    expect(parseSession(rest, 5)?.expiresAt).toBe(1_780_003_600_000)
  })

  it('fills user and email from the fallback when the answer leaves them out', () => {
    const { user: _unused, ...rest } = answer
    expect(parseSession(rest, 0, { userId: 'u-old', email: 'old@example.com' })).toMatchObject({
      userId: 'u-old',
      email: 'old@example.com',
    })
    expect(
      parseSession({ ...answer, user: { id: 'user-0001' } }, 0, { email: 'typed@example.com' })
        ?.email,
    ).toBe('typed@example.com')
  })

  it('is null for anything unusable', () => {
    for (const bad of [
      null,
      'nope',
      [],
      {},
      { ...answer, access_token: '' },
      { ...answer, refresh_token: undefined },
      { ...answer, user: {} },
      { ...answer, expires_in: 'soon', expires_at: undefined },
    ]) {
      expect(parseSession(bad, 0), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('parseUser, parseSettings, parseServerTime', () => {
  it('reads the user', () => {
    expect(parseUser({ id: 'u1', email: 'ana@example.com', role: 'authenticated' })).toEqual({
      id: 'u1',
      email: 'ana@example.com',
    })
    expect(parseUser({ id: 'u1' })).toEqual({ id: 'u1', email: '' })
    expect(parseUser({})).toBeNull()
    expect(parseUser(null)).toBeNull()
  })

  it('reads whether email sign-in is on and sign-ups are open', () => {
    expect(
      parseSettings({ external: { email: true, phone: false }, disable_signup: false }),
    ).toEqual({
      emailEnabled: true,
      signupsOpen: true,
    })
    expect(parseSettings({ external: { email: false }, disable_signup: true })).toEqual({
      emailEnabled: false,
      signupsOpen: false,
    })
    expect(parseSettings({ external: {} })).toEqual({ emailEnabled: false, signupsOpen: true })
    expect(parseSettings({})).toBeNull()
    expect(parseSettings('<html>')).toBeNull()
  })

  it('reads the server clock as a number, or a bigint sent as text', () => {
    expect(parseServerTime(1_780_000_000_123)).toBe(1_780_000_000_123)
    expect(parseServerTime('1780000000123')).toBe(1_780_000_000_123)
    for (const bad of [null, {}, 'now', '12.5', Number.NaN, [1]]) {
      expect(parseServerTime(bad), String(bad)).toBeNull()
    }
  })
})

describe('parsePullRows', () => {
  const wire = {
    tbl: 'tasks',
    id: 'task-1',
    updated_at: 1_780_000_000_000,
    device_id: 'device-a',
    deleted: false,
    schema_version: 3,
    data: { id: 'task-1' },
    seq: 41,
  }

  it('camel-cases a page, keeping its order', () => {
    const page = parsePullRows([
      wire,
      { ...wire, id: 'task-2', seq: 42, deleted: true, data: null },
    ])
    expect(page).toEqual([
      {
        tbl: 'tasks',
        id: 'task-1',
        updatedAt: 1_780_000_000_000,
        deviceId: 'device-a',
        deleted: false,
        schemaVersion: 3,
        data: { id: 'task-1' },
        seq: 41,
      },
      {
        tbl: 'tasks',
        id: 'task-2',
        updatedAt: 1_780_000_000_000,
        deviceId: 'device-a',
        deleted: true,
        schemaVersion: 3,
        data: null,
        seq: 42,
      },
    ])
  })

  it('accepts an empty page, bigints as text, and a table this Forge does not know', () => {
    expect(parsePullRows([])).toEqual([])
    expect(
      parsePullRows([{ ...wire, seq: '7000000000', updated_at: '1780000000000' }]),
    ).toMatchObject([{ seq: 7_000_000_000, updatedAt: 1_780_000_000_000 }])
    expect(parsePullRows([{ ...wire, tbl: 'futureTable' }])).toMatchObject([{ tbl: 'futureTable' }])
  })

  it('turns a missing data column into null', () => {
    const { data: _unused, ...rest } = wire
    expect(parsePullRows([rest])).toMatchObject([{ data: null }])
  })

  it('is null when the answer is not an array, or any row is malformed', () => {
    for (const bad of [
      null,
      {},
      'rows',
      [null],
      [wire, { ...wire, seq: undefined }],
      [{ ...wire, deleted: 'false' }],
      [{ ...wire, id: '' }],
      [{ ...wire, device_id: 5 }],
      [{ ...wire, schema_version: null }],
      [{ ...wire, updated_at: 'yesterday' }],
    ]) {
      expect(parsePullRows(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('errorDetail', () => {
  it('reads GoTrue errors under the 2024-01-01 API version (code is text)', () => {
    expect(
      errorDetail({ code: 'otp_expired', message: 'Token has expired or is invalid' }),
    ).toEqual({
      code: 'otp_expired',
      message: 'Token has expired or is invalid',
    })
  })

  it('reads legacy GoTrue errors (code is the status, error_code is the text)', () => {
    expect(
      errorDetail({ code: 403, error_code: 'otp_expired', msg: 'Email link is invalid' }),
    ).toEqual({
      code: 'otp_expired',
      message: 'Email link is invalid',
    })
    expect(errorDetail({ code: 422, msg: 'Signups not allowed' })).toEqual({
      code: null,
      message: 'Signups not allowed',
    })
  })

  it('reads OAuth-style, PostgREST and gateway errors', () => {
    expect(
      errorDetail({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }),
    ).toEqual({ code: 'invalid_grant', message: 'Invalid Refresh Token' })
    expect(
      errorDetail({
        code: 'PGRST205',
        message: 'Could not find the table',
        details: null,
        hint: null,
      }),
    ).toEqual({ code: 'PGRST205', message: 'Could not find the table' })
    expect(
      errorDetail({ code: '42501', message: 'new row violates row-level security policy' }).code,
    ).toBe('42501')
    expect(errorDetail({ message: 'Invalid API key', hint: 'Double check your key' })).toEqual({
      code: null,
      message: 'Invalid API key',
    })
  })

  it('never takes free text for a code', () => {
    expect(errorDetail({ error: 'Something went wrong, please try again' }).code).toBeNull()
    expect(errorDetail({ code: 'x'.repeat(65) }).code).toBeNull()
  })

  it('copes with bodies that are not objects', () => {
    for (const body of [null, undefined, '', 'Bad Gateway', 502, [], [{ code: 'x' }]]) {
      expect(errorDetail(body)).toEqual({ code: null, message: '' })
    }
  })
})
