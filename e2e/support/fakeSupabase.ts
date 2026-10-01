import { createHash } from 'node:crypto'
import type { BrowserContext, Route } from '@playwright/test'
import { SyncTransportError, type PushRow, type ServerRow } from '../../src/logic/sync'
import { SyncServerModel, type ModelPushRow } from '../../src/logic/syncServerModel'
import { FIXED_NOW } from '../fixtures'

/**
 * A fake Supabase project for the sync specs (PLAN §4.7.8): the GoTrue and PostgREST endpoints the app
 * calls (§4.7.1), answered through `page.route`, over the same `SyncServerModel` the repo tests use
 * (`forge_rows` and its trigger, rule for rule: stamp clamp, last write wins, `seq`, row-level security,
 * constraints). One instance is one project: create it per test and attach every browser context that is
 * "a device of this person" to it.
 *
 * The origin is a real-shaped `https://<20 chars>.supabase.co`, because the app's CSP (`connect-src
 * https://*.supabase.co`) is checked before `page.route` sees a request. Every other `*.supabase.co` host
 * is refused and remembered (`strayHosts`), so a spec can say "nothing else was contacted".
 *
 * It is strict where the real services are, so a wrong request fails here instead of in someone's
 * project: the `apikey` header must be the project's key, a `sb_publishable_…` key is never a bearer,
 * the auth calls carry `X-Supabase-Api-Version`, the pull query must ask for `seq=gt.N&order=seq.asc`,
 * and a push body must be an array whose objects all have the same keys (PostgREST's bulk rule).
 *
 * No secret-shaped literal lives in this file: the keys are assembled at runtime.
 */

export const FAKE_PROJECT_REF = 'forgetestforgetestfo'
export const FAKE_PROJECT_URL = `https://${FAKE_PROJECT_REF}.supabase.co`

/** A new-format publishable key (the anon key of the fake project). Assembled here so no file holds one. */
export const fakeAnonKey = (): string =>
  ['sb', 'publishable', 'FAKEforgetest0123456789abcd'].join('_')
/** A secret key: the form must refuse it. */
export const fakeSecretKey = (): string => ['sb', 'secret', 'FAKEforgetest0123456789abcd'].join('_')

const base64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

/** A legacy JWT with the given role (the signature is not one: the app never verifies it, nor does this). */
export function fakeJwt(role: 'anon' | 'service_role', ref = FAKE_PROJECT_REF): string {
  return [
    base64url({ alg: 'HS256', typ: 'JWT' }),
    base64url({ iss: 'supabase', ref, role }),
    'FAKEsignatureFAKEsignature',
  ].join('.')
}

/** A deterministic UUID for an email address (`auth.users.id`). */
function userIdOf(email: string): string {
  const h = createHash('sha1').update(email.trim().toLowerCase()).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** What the app asked of the fake, for assertions. Headers are lower-cased; a token is fake but still not printed by specs. */
export interface LoggedRequest {
  method: string
  /** Path without the query, e.g. `/auth/v1/otp`. */
  path: string
  query: URLSearchParams
  headers: Record<string, string>
  /** The JSON body, or null when there is none. */
  body: unknown
}

/** The last email the fake "sent" to an address. */
export interface SentEmail {
  email: string
  /** The 6-digit code in the email. */
  code: string
  /** The code the link carries (`?code=`): it opens `/settings/sync?code=<authCode>`. */
  authCode: string
  redirectTo: string
  codeChallenge: string
}

export interface FakeSupabaseOptions {
  /** The server clock before the offset and the per-call tick. Default: the e2e clock, `FIXED_NOW`. */
  clock?: () => number
  /** The kind of anon key the project hands out: a new `sb_publishable_…` key (default) or a legacy anon JWT. */
  keyKind?: 'publishable' | 'anonJwt'
}

/** One browser context's connection to the project. */
export interface Link {
  /** Every request from this context fails as if there were no network. */
  offline: boolean
}

type Json = Record<string, unknown>

interface Reply {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

const ok = (body: unknown = {}): Reply => ({ status: 200, body })

/** A GoTrue error body (`error_code` under the 2024-01-01 API version). */
const authError = (status: number, code: string, message: string): Reply => ({
  status,
  body: { code: status, error_code: code, msg: message },
})

/** A PostgREST error body. */
const restError = (status: number, code: string, message: string): Reply => ({
  status,
  body: { code, message, details: null, hint: null },
})

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export class FakeSupabase {
  /** The `forge_rows` table: exactly what the repo tests' fake server runs on. */
  readonly model = new SyncServerModel()
  /** Every request the project received, in order. */
  readonly requests: LoggedRequest[] = []
  /** Requests to a `*.supabase.co` host that is not this project (there must be none). */
  readonly strayHosts: string[] = []

  /** Email sign-in is switched on in the project's Auth settings. */
  emailEnabled = true
  /** "Allow new users to sign up". */
  signupsOpen = true
  /** The next sign-in emails are refused with 429 (`over_email_send_rate_limit`). */
  emailRateLimited = false
  /** Every `/rest/v1` call answers this status (540: a paused free project) while it is set. */
  restStatus: number | null = null
  /** Added to the server clock: a server whose clock is ahead (+) of the device's. */
  clockOffsetMs = 0
  /** The project's anon key. A call with another `apikey` is a 401. */
  readonly anonKey: string
  readonly keyKind: 'publishable' | 'anonJwt'

  private readonly clock: () => number
  private tick = 0
  private counter = 0
  private readonly sent = new Map<string, SentEmail>()
  private readonly accounts = new Map<string, string>()
  /** access token → user id */
  private readonly access = new Map<string, string>()
  /** refresh token → account; a refresh token works once (rotation). */
  private readonly refresh = new Map<string, { userId: string; email: string }>()

  constructor(options: FakeSupabaseOptions = {}) {
    this.clock = options.clock ?? (() => FIXED_NOW.getTime())
    this.keyKind = options.keyKind ?? 'publishable'
    this.anonKey = this.keyKind === 'publishable' ? fakeAnonKey() : fakeJwt('anon')
  }

  // ─── Wiring ───────────────────────────────────────────────────────────────

  /** Serves the project to every page of `context`. Returns the connection: flip `offline` to cut it. */
  async attach(context: BrowserContext): Promise<Link> {
    const link: Link = { offline: false }
    await context.route(/^https:\/\/[^/]+\.supabase\.co\//, (route) => this.handle(route, link))
    return link
  }

  /** The server's clock: never the same value twice, so stamps and skew behave like the real `now()`. */
  now(): number {
    this.tick += 1
    return this.clock() + this.clockOffsetMs + this.tick
  }

  // ─── Looking at and changing the project from a spec ──────────────────────

  /** The email the app "sent" last to `email`. */
  lastEmail(email: string): SentEmail {
    const mail = this.sent.get(email.trim().toLowerCase())
    if (mail === undefined) throw new Error(`No sign-in email was sent to ${email}`)
    return mail
  }

  /** The account's rows, tombstones included, in `seq` order. */
  rows(email: string): ServerRow[] {
    return this.model.rows(userIdOf(email))
  }

  /** One row of the account (a tombstone included), or undefined. */
  row(email: string, tbl: string, id: string): ServerRow | undefined {
    return this.model.get(userIdOf(email), tbl, id)
  }

  /** The row's `data` as an object, or null when there is no row or it is a tombstone. */
  data(email: string, tbl: string, id: string): Json | null {
    const row = this.row(email, tbl, id)
    return row !== undefined && !row.deleted && isObject(row.data) ? row.data : null
  }

  /** `delete from public.forge_rows where user_id = auth.uid()`, the README's way to erase the cloud copy. */
  erase(email: string): number {
    return this.model.erase(userIdOf(email))
  }

  /** Another device's write, by any means, straight into the account. */
  inject(email: string, rows: readonly PushRow[]): void {
    this.model.push(userIdOf(email), rows, this.now())
  }

  /** Makes every access token of the account stale, as an hour passing would: the next data call is a 401. */
  expireAccessTokens(): void {
    this.access.clear()
  }

  /** Makes every refresh token stale, as a revoked session would: a refresh is refused (`invalid_grant`). */
  revokeSessions(): void {
    this.access.clear()
    this.refresh.clear()
  }

  /** The requests to one path (`/rest/v1/forge_rows`, `/auth/v1/otp`, …), optionally of one method. */
  calls(path: string, method?: string): LoggedRequest[] {
    return this.requests.filter(
      (r) => r.path === path && (method === undefined || r.method === method),
    )
  }

  /** The project's data calls, `/rest/v1/*`. */
  get restCalls(): LoggedRequest[] {
    return this.requests.filter((r) => r.path.startsWith('/rest/v1/'))
  }

  // ─── The wire ─────────────────────────────────────────────────────────────

  private async handle(route: Route, link: Link): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    if (url.host !== `${FAKE_PROJECT_REF}.supabase.co`) {
      this.strayHosts.push(url.host)
      await route.abort('connectionrefused')
      return
    }
    // A preflight is answered by Playwright itself (and only if the page may talk to this host at all).
    if (link.offline) {
      await route.abort('internetdisconnected')
      return
    }
    const headers = request.headers()
    let body: unknown = null
    const raw = request.postData()
    if (raw !== null && raw !== '') {
      try {
        body = JSON.parse(raw) as unknown
      } catch {
        await this.send(route, headers, restError(400, 'PGRST102', 'Empty or invalid json'))
        return
      }
    }
    const logged: LoggedRequest = {
      method: request.method(),
      path: url.pathname,
      query: url.searchParams,
      headers,
      body,
    }
    this.requests.push(logged)
    await this.send(route, headers, this.reply(logged))
  }

  private async send(
    route: Route,
    requestHeaders: Record<string, string>,
    reply: Reply,
  ): Promise<void> {
    const hasBody = reply.body !== undefined
    await route.fulfill({
      status: reply.status,
      headers: {
        'Access-Control-Allow-Origin': requestHeaders.origin ?? '*',
        'Access-Control-Expose-Headers': 'Retry-After, Content-Range',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...reply.headers,
      },
      body: hasBody ? JSON.stringify(reply.body) : '',
    })
  }

  private reply(req: LoggedRequest): Reply {
    if (req.headers.apikey !== this.anonKey) {
      return { status: 401, body: { message: 'Invalid API key', hint: 'Check the anon key.' } }
    }
    // A `sb_publishable_…` key is not a JWT: it is never the bearer (PLAN §4.7.1). A legacy anon JWT may be.
    if (this.keyKind === 'publishable' && req.headers.authorization === `Bearer ${this.anonKey}`) {
      return restError(401, 'PGRST301', 'A publishable key is not a bearer token')
    }
    if (req.path.startsWith('/auth/v1/')) {
      if (req.headers['x-supabase-api-version'] !== '2024-01-01') {
        return authError(400, 'validation_failed', 'Missing X-Supabase-Api-Version')
      }
      return this.auth(req)
    }
    if (req.path.startsWith('/rest/v1/')) {
      if (this.restStatus !== null) {
        return { status: this.restStatus, body: { message: 'The project is not reachable' } }
      }
      return this.rest(req)
    }
    return { status: 404, body: { message: `No route for ${req.path}` } }
  }

  // ─── GoTrue ───────────────────────────────────────────────────────────────

  private auth(req: LoggedRequest): Reply {
    const grant = req.query.get('grant_type')
    const body = isObject(req.body) ? req.body : {}
    switch (`${req.method} ${req.path}`) {
      case 'GET /auth/v1/settings':
        return ok({
          external: { email: this.emailEnabled, phone: false },
          disable_signup: !this.signupsOpen,
          mailer_autoconfirm: false,
        })
      case 'POST /auth/v1/otp':
        return this.otp(req, body)
      case 'POST /auth/v1/verify':
        return this.verify(body)
      case 'POST /auth/v1/token':
        if (grant === 'pkce') return this.exchange(body)
        if (grant === 'refresh_token') return this.refreshToken(body)
        return authError(400, 'validation_failed', 'Unsupported grant type')
      case 'GET /auth/v1/user': {
        const userId = this.bearerUser(req)
        if (userId === null) return authError(401, 'bad_jwt', 'invalid JWT')
        return ok({ id: userId, email: this.emailOf(userId) })
      }
      case 'POST /auth/v1/logout':
        return { status: 204 }
      default:
        return { status: 404, body: { message: `No route for ${req.path}` } }
    }
  }

  private otp(req: LoggedRequest, body: Json): Reply {
    if (this.emailRateLimited) {
      return authError(429, 'over_email_send_rate_limit', 'email rate limit exceeded')
    }
    const email = text(body.email).trim().toLowerCase()
    if (email === '') return authError(422, 'validation_failed', 'Email is required')
    if (!this.emailEnabled)
      return authError(422, 'email_provider_disabled', 'Email logins are disabled')
    const known = this.accounts.has(email)
    if (!known && (!this.signupsOpen || body.create_user !== true)) {
      return authError(422, 'signup_disabled', 'Signups not allowed for this instance')
    }
    if (
      text(body.code_challenge_method).toLowerCase() !== 's256' ||
      text(body.code_challenge) === ''
    ) {
      return authError(400, 'validation_failed', 'A PKCE challenge is required')
    }
    this.counter += 1
    const mail: SentEmail = {
      email,
      code: String(482_900 + this.counter),
      authCode: `00000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`,
      redirectTo: req.query.get('redirect_to') ?? '',
      codeChallenge: text(body.code_challenge),
    }
    this.sent.set(email, mail)
    return ok()
  }

  /** The code typed from the email. */
  private verify(body: Json): Reply {
    const email = text(body.email).trim().toLowerCase()
    const mail = this.sent.get(email)
    if (body.type !== 'email' || mail === undefined || mail.code !== text(body.token)) {
      return authError(403, 'otp_expired', 'Token has expired or is invalid')
    }
    this.sent.delete(email)
    return this.session(email)
  }

  /** The link came back: `?code=` and the verifier this device kept. */
  private exchange(body: Json): Reply {
    const mail = [...this.sent.values()].find((m) => m.authCode === text(body.auth_code))
    if (mail === undefined) return authError(404, 'flow_state_not_found', 'invalid flow state')
    const challenge = createHash('sha256').update(text(body.code_verifier)).digest('base64url')
    if (challenge !== mail.codeChallenge) {
      return authError(
        400,
        'bad_code_verifier',
        'code challenge does not match previously saved code verifier',
      )
    }
    this.sent.delete(mail.email)
    return this.session(mail.email)
  }

  private refreshToken(body: Json): Reply {
    const token = text(body.refresh_token)
    const holder = this.refresh.get(token)
    if (holder === undefined) {
      return authError(
        400,
        'refresh_token_not_found',
        'Invalid Refresh Token: Refresh Token Not Found',
      )
    }
    this.refresh.delete(token)
    return this.session(holder.email)
  }

  /** A new session: an hour of access token and a refresh token that works once. */
  private session(email: string): Reply {
    const userId = userIdOf(email)
    this.accounts.set(email, userId)
    this.counter += 1
    const accessToken = `fake-access-${this.counter}`
    const refreshToken = `fake-refresh-${this.counter}`
    this.access.set(accessToken, userId)
    this.refresh.set(refreshToken, { userId, email })
    return ok({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(this.clock() / 1000) + 3600,
      refresh_token: refreshToken,
      user: { id: userId, email },
    })
  }

  private bearerUser(req: LoggedRequest): string | null {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
    return match?.[1] === undefined ? null : (this.access.get(match[1]) ?? null)
  }

  private emailOf(userId: string): string {
    for (const [email, id] of this.accounts) if (id === userId) return email
    return ''
  }

  // ─── PostgREST ────────────────────────────────────────────────────────────

  private rest(req: LoggedRequest): Reply {
    // A bearer that is not a live access token is an expired JWT; no bearer is the anon role.
    const bearer = req.headers.authorization
    const userId = this.bearerUser(req)
    if (bearer !== undefined && userId === null) return restError(401, 'PGRST303', 'JWT expired')
    try {
      switch (`${req.method} ${req.path}`) {
        case 'GET /rest/v1/forge_rows':
          return this.pull(req, userId)
        case 'POST /rest/v1/forge_rows':
          return this.push(req, userId)
        case 'POST /rest/v1/rpc/forge_now':
          return ok(this.model.serverTime(userId, this.now()))
        default:
          return restError(404, 'PGRST125', `Invalid path specified in request URL: ${req.path}`)
      }
    } catch (error) {
      if (error instanceof SyncTransportError) {
        return restError(error.status ?? 500, error.code ?? 'XX000', error.message)
      }
      throw error
    }
  }

  private pull(req: LoggedRequest, userId: string | null): Reply {
    const cursor = /^gt\.(\d+)$/.exec(req.query.get('seq') ?? '')
    const limit = /^\d+$/.exec(req.query.get('limit') ?? '')
    if (cursor?.[1] === undefined || limit === null || req.query.get('order') !== 'seq.asc') {
      return restError(400, 'PGRST100', 'A pull asks for seq=gt.N, order=seq.asc and a limit')
    }
    const rows = this.model.pull(userId, Number(cursor[1]), Number(limit[0]))
    return ok(
      rows.map((r) => ({
        tbl: r.tbl,
        id: r.id,
        updated_at: r.updatedAt,
        device_id: r.deviceId,
        deleted: r.deleted,
        schema_version: r.schemaVersion,
        data: r.data,
        seq: r.seq,
      })),
    )
  }

  private push(req: LoggedRequest, userId: string | null): Reply {
    const { body } = req
    if (!Array.isArray(body)) return restError(400, 'PGRST102', 'A push body is an array of rows')
    // PostgREST's bulk rule: every object has the same keys.
    const keys = (row: unknown): string => (isObject(row) ? Object.keys(row).sort().join(',') : '')
    if (body.some((row) => keys(row) !== keys(body[0]))) {
      return restError(400, 'PGRST102', 'All object keys must match')
    }
    if (!/(^|,)resolution=merge-duplicates(,|$)/.test(req.headers.prefer ?? '')) {
      return restError(
        409,
        '23505',
        'duplicate key value violates unique constraint "forge_rows_pkey"',
      )
    }
    const rows: ModelPushRow[] = body.map((row) => {
      const r = row as Json
      return {
        userId: text(r.user_id),
        tbl: text(r.tbl) as PushRow['tbl'],
        id: text(r.id),
        updatedAt: r.updated_at as number,
        deviceId: text(r.device_id),
        deleted: r.deleted === true,
        schemaVersion: r.schema_version as number,
        data: r.data ?? null,
      }
    })
    this.model.push(userId, rows, this.now())
    return { status: 201 }
  }
}
