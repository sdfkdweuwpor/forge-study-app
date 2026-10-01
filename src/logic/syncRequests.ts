/**
 * Requests to the person's Supabase project, as plain data (pure; PLAN §4.7.1). Each builder returns an
 * `HttpRequest`: method, URL, headers and the JSON body already serialised. `features/sync/supabase/http`
 * sends it; nothing here touches the network, a clock or randomness, so a request is a function of its
 * inputs and building it twice gives the same bytes (that is what makes a retried push harmless).
 *
 * Headers (§4.7.1, checked against @supabase/auth-js 2.117.2):
 *  - every call: `apikey`, `Content-Type: application/json`;
 *  - `Authorization: Bearer <access token>` once signed in; before that a legacy anon JWT doubles as the
 *    bearer, and a new `sb_publishable_…` key is never sent as one (it is not a JWT);
 *  - GoTrue (`/auth/v1`) calls add `X-Supabase-Api-Version: 2024-01-01`, so errors carry codes;
 *  - the refresh call never carries the (expired) access token.
 *
 * The response parsers are here for the same reason: they are pure, and a page of rows or a token
 * response is the transport's contract with the engine. They return `null` for an unusable answer.
 */
import type { Millis, SyncSession } from '@/db/types'
import type { PushRow, ServerRow } from './sync'
import type { SyncConfig } from './syncConfig'
import type { SyncTableName } from './syncTables'

/** What the request builders need of a validated config (`SyncConfig` from `syncConfig.ts`). */
export type TransportConfig = Pick<SyncConfig, 'url' | 'anonKey' | 'keyKind'>
/** What a signed-in call needs of the session. */
export type SessionAuth = Pick<SyncSession, 'accessToken' | 'userId'>

export type RequestOp =
  | 'settings'
  | 'otp'
  | 'pkce'
  | 'verify'
  | 'refresh'
  | 'user'
  | 'logout'
  | 'serverTime'
  | 'pull'
  | 'push'

/** One call, ready for `fetch`. `credentials: 'omit'` and `cache: 'no-store'` are added by the sender. */
export interface HttpRequest {
  op: RequestOp
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  /** JSON text, or null when the call has no body. */
  body: string | null
  /** Let the request outlive the page (a push while it is being hidden; the body must stay under 64 KB). */
  keepalive: boolean
  /** The signed-in access token is the bearer. */
  session: boolean
}

export const API_VERSION = '2024-01-01'
export const PULL_COLUMNS = 'tbl,id,updated_at,device_id,deleted,schema_version,data,seq'
const PUSH_PREFER = 'resolution=merge-duplicates,return=minimal'

interface Options {
  session?: SessionAuth
  body?: unknown
  prefer?: string
  keepalive?: boolean
}

/**
 * Postgres `jsonb` refuses a string holding a lone UTF-16 surrogate (`JSON.stringify` writes one as
 * `\ud83d`) or U+0000, and then refuses the whole batch, not just that row. Forge cuts text by code unit
 * (`slice(0, MAX)`), which can split an emoji, so a body is made well-formed before it is sent: a lone
 * surrogate becomes U+FFFD, NUL is dropped, and a valid pair is left alone. Same input, same bytes.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g
const wellFormed = (s: string): string =>
  s.replace(LONE_SURROGATE, (m) => (m.length === 2 ? m : '\uFFFD')).replaceAll('\0', '')

/** A `JSON.stringify` replacer that applies `wellFormed` to every string, object keys included. */
function scrub(_key: string, value: unknown): unknown {
  if (typeof value === 'string') return wellFormed(value)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const entries = Object.entries(value)
  return entries.some(([k]) => wellFormed(k) !== k)
    ? Object.fromEntries(entries.map(([k, v]) => [wellFormed(k), v]))
    : value
}

function build(
  op: RequestOp,
  method: 'GET' | 'POST',
  config: TransportConfig,
  path: string,
  opts: Options = {},
): HttpRequest {
  const headers: Record<string, string> = {
    apikey: config.anonKey,
    'Content-Type': 'application/json',
  }
  const bearer = opts.session?.accessToken ?? (config.keyKind === 'anonJwt' ? config.anonKey : null)
  if (bearer !== null) headers.Authorization = `Bearer ${bearer}`
  if (path.startsWith('/auth/v1/')) headers['X-Supabase-Api-Version'] = API_VERSION
  if (opts.prefer !== undefined) headers.Prefer = opts.prefer
  return {
    op,
    method,
    url: config.url.replace(/\/+$/, '') + path,
    headers,
    body: opts.body === undefined ? null : JSON.stringify(opts.body, scrub),
    keepalive: opts.keepalive ?? false,
    session: opts.session !== undefined,
  }
}

function integer(value: number, min: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${name} must be a whole number of at least ${min}`)
  }
  return value
}

// ─── GoTrue ─────────────────────────────────────────────────────────────────

/** Check the project: 200 with `external.email` is a working project and key. */
export const settingsRequest = (config: TransportConfig): HttpRequest =>
  build('settings', 'GET', config, '/auth/v1/settings')

/** Send the sign-in email: a PKCE link and (with the template of §4.7.2) a code. */
export function otpRequest(
  config: TransportConfig,
  input: { email: string; redirectTo: string; codeChallenge: string },
): HttpRequest {
  const query =
    input.redirectTo === '' ? '' : `?redirect_to=${encodeURIComponent(input.redirectTo)}`
  return build('otp', 'POST', config, `/auth/v1/otp${query}`, {
    body: {
      email: input.email.trim(),
      create_user: true,
      data: {},
      code_challenge: input.codeChallenge,
      code_challenge_method: 's256',
    },
  })
}

/** The link came back with `?code=`: trade it, with the verifier kept from the request, for a session. */
export const pkceRequest = (
  config: TransportConfig,
  input: { authCode: string; codeVerifier: string },
): HttpRequest =>
  build('pkce', 'POST', config, '/auth/v1/token?grant_type=pkce', {
    body: { auth_code: input.authCode, code_verifier: input.codeVerifier },
  })

/** The 6–10 digit code from the same email; spaces (`123 456`) are dropped. */
export const verifyRequest = (
  config: TransportConfig,
  input: { email: string; code: string },
): HttpRequest =>
  build('verify', 'POST', config, '/auth/v1/verify', {
    body: { type: 'email', email: input.email.trim(), token: input.code.replace(/\s+/g, '') },
  })

/** A new access token. Sent with the anon bearer, never with the session's own token. */
export const refreshRequest = (config: TransportConfig, refreshToken: string): HttpRequest =>
  build('refresh', 'POST', config, '/auth/v1/token?grant_type=refresh_token', {
    body: { refresh_token: refreshToken },
  })

export const userRequest = (config: TransportConfig, session: SessionAuth): HttpRequest =>
  build('user', 'GET', config, '/auth/v1/user', { session })

/** End this device's session on the server (`scope=local` leaves the account's other devices alone). */
export const logoutRequest = (config: TransportConfig, session: SessionAuth): HttpRequest =>
  build('logout', 'POST', config, '/auth/v1/logout?scope=local', { session })

// ─── PostgREST ──────────────────────────────────────────────────────────────

/** The server's clock in ms (`forge_now()`), to measure this device's skew. */
export const serverTimeRequest = (config: TransportConfig, session: SessionAuth): HttpRequest =>
  build('serverTime', 'POST', config, '/rest/v1/rpc/forge_now', { session, body: {} })

/** Rows with `seq` above the cursor, oldest first. RLS limits the answer to the signed-in account. */
export function pullRequest(
  config: TransportConfig,
  session: SessionAuth,
  afterSeq: number,
  limit: number,
): HttpRequest {
  const cursor = integer(afterSeq, 0, 'afterSeq')
  const page = integer(limit, 1, 'limit')
  return build(
    'pull',
    'GET',
    config,
    `/rest/v1/forge_rows?select=${PULL_COLUMNS}&seq=gt.${cursor}&order=seq.asc&limit=${page}`,
    { session },
  )
}

/**
 * Upsert a batch. Every object has the same keys in the same order (PostgREST's bulk rule; a tombstone
 * carries `data: null`), rows keep the order given (the server takes its account lock per row, so a
 * stable order is what keeps concurrent pushes from deadlocking), and nothing in the body or headers
 * varies between calls: the same rows always make the same request, so repeating one whose answer was
 * lost changes nothing on the server (an equal stamp from the same device is accepted). The keys
 * `(tbl, id)` must be unique within a batch or PostgREST refuses it.
 */
export function pushRequest(
  config: TransportConfig,
  session: SessionAuth,
  rows: readonly PushRow[],
  opts: { keepalive?: boolean } = {},
): HttpRequest {
  return build('push', 'POST', config, '/rest/v1/forge_rows?on_conflict=user_id,tbl,id', {
    session,
    prefer: PUSH_PREFER,
    keepalive: opts.keepalive,
    body: rows.map((r) => ({
      user_id: session.userId,
      tbl: r.tbl,
      id: r.id,
      updated_at: r.updatedAt,
      device_id: r.deviceId,
      deleted: r.deleted,
      schema_version: r.schemaVersion,
      data: r.data === undefined ? null : r.data,
    })),
  })
}

// ─── Responses ──────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>

const asObj = (v: unknown): Obj | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
/** A JSON number, or a bigint that came back as text. */
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && /^-?\d+$/.test(v)
      ? Number(v)
      : null

/**
 * The machine-readable code and the server's message from an error body, whichever service wrote it:
 * GoTrue (`error_code`, or `code` as text under the 2024-01-01 API version; legacy `code` is a number),
 * OAuth-style (`error`, `error_description`), PostgREST (`code`, `message`) and the gateway (`message`).
 * A code must look like an identifier (`PGRST205`, `over_email_send_rate_limit`), so free text is
 * never taken for one. The message is for matching only; Forge never shows the server's words.
 */
export function errorDetail(body: unknown): { code: string | null; message: string } {
  const o = asObj(body)
  if (o === null) return { code: null, message: '' }
  const code = str(o.error_code) ?? str(o.code) ?? str(o.error)
  return {
    code: code !== null && /^\w{1,64}$/.test(code) ? code : null,
    message: str(o.msg) ?? str(o.message) ?? str(o.error_description) ?? '',
  }
}

/**
 * A session from a GoTrue token response (`/token`, `/verify`). `expiresAt` counts `expires_in` from `now`
 * (the time the request was made, on this device's clock: a device whose clock is off still refreshes on
 * time), else the server's `expires_at` (seconds). `fallback` fills what the answer leaves out.
 */
export function parseSession(
  body: unknown,
  now: Millis,
  fallback: { userId?: string; email?: string } = {},
): SyncSession | null {
  const o = asObj(body)
  if (o === null) return null
  const user = asObj(o.user)
  const accessToken = str(o.access_token)
  const refreshToken = str(o.refresh_token)
  const seconds = num(o.expires_in)
  const at = num(o.expires_at)
  const userId = str(user?.id) ?? fallback.userId ?? null
  if (accessToken === null || refreshToken === null || userId === null) return null
  const expiresAt = seconds !== null ? now + seconds * 1000 : at !== null ? at * 1000 : null
  if (expiresAt === null) return null
  return {
    accessToken,
    refreshToken,
    expiresAt,
    userId,
    email: str(user?.email) ?? fallback.email ?? '',
  }
}

/** `GET /auth/v1/user`: the account. */
export function parseUser(body: unknown): { id: string; email: string } | null {
  const o = asObj(body)
  const id = str(o?.id)
  return o === null || id === null ? null : { id, email: str(o.email) ?? '' }
}

/** `GET /auth/v1/settings`: whether email sign-in is on, and whether a new address may be created. */
export function parseSettings(
  body: unknown,
): { emailEnabled: boolean; signupsOpen: boolean } | null {
  const o = asObj(body)
  const external = asObj(o?.external)
  if (o === null || external === null) return null
  return { emailEnabled: external.email === true, signupsOpen: o.disable_signup !== true }
}

/** `forge_now()`: a bare number (bigint), possibly as text. */
export const parseServerTime = (body: unknown): Millis | null => num(body)

/**
 * A page of `forge_rows`, camel-cased. Null when the answer is not an array of well-formed rows (one bad
 * row voids the page: the cursor must not move past a row Forge could not read). `tbl` is passed through
 * as it came; a table this Forge does not know is the engine's `unknownTable`.
 */
export function parsePullRows(body: unknown): ServerRow[] | null {
  if (!Array.isArray(body)) return null
  const rows: ServerRow[] = []
  for (const item of body as unknown[]) {
    const r = asObj(item)
    const tbl = str(r?.tbl)
    const id = str(r?.id)
    const deviceId = str(r?.device_id)
    const updatedAt = num(r?.updated_at)
    const schemaVersion = num(r?.schema_version)
    const seq = num(r?.seq)
    if (
      r === null ||
      tbl === null ||
      id === null ||
      deviceId === null ||
      updatedAt === null ||
      schemaVersion === null ||
      seq === null ||
      typeof r.deleted !== 'boolean'
    ) {
      return null
    }
    rows.push({
      tbl: tbl as SyncTableName,
      id,
      updatedAt,
      deviceId,
      deleted: r.deleted,
      schemaVersion,
      data: r.data === undefined ? null : r.data,
      seq,
    })
  }
  return rows
}
