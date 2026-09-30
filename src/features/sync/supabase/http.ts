/**
 * The one place a request to Supabase is sent (PLAN §4.7.1). `createHttp` wraps an injected `fetch`
 * (tests pass a fake; the app passes `fetch`) with a timeout (`AbortController`), JSON handling and error
 * mapping. It never retries: whether and when to try again is the engine's call (`planRetry`).
 *
 * Every failure is a `SupabaseError`, a `SyncTransportError` (the shape the engine and its fake server
 * share) with one extra field, `reason`, for the setup and sign-in forms. The message is fixed, calm text
 * chosen here; nothing the server said, no URL, no header and no token is ever put in an error, and
 * nothing here logs.
 *
 * | reason        | from                                                                    | kind        |
 * |---------------|-------------------------------------------------------------------------|-------------|
 * | offline       | fetch rejected (no network, wrong address)                              | offline     |
 * | unavailable   | 5xx (520 and up: a paused free project), a timeout                      | server      |
 * | unauthorized  | 401 on a session; 403 or any 401 from sign-in calls; a refused refresh  | signedOut   |
 * | badKey        | 401 that names the API key, or any 401 before there is a session        | signedOut   |
 * | rateLimited   | 429, GoTrue rate-limit codes (`retryAfterMs` from `Retry-After`)        | rateLimited |
 * | setup         | PGRST205, 42P01, PGRST202: `forge_rows` or `forge_now` is missing        | setup       |
 * | forbidden     | 42501, 403 on the data calls: the table's policies are missing          | forbidden   |
 * | tooLarge      | 413                                                                     | tooLarge    |
 * | rejected      | any other refusal, or an answer that cannot be read                     | server      |
 */
import type { Millis, SyncErrorKind } from '@/db/types'
import { classifySyncError, parseRetryAfter, SyncTransportError } from '@/logic/sync'
import { errorDetail, type HttpRequest } from '@/logic/syncRequests'

export type FailureReason =
  | 'offline'
  | 'unavailable'
  | 'unauthorized'
  | 'badKey'
  | 'rateLimited'
  | 'setup'
  | 'forbidden'
  | 'tooLarge'
  | 'rejected'

/** A failed call, reduced to what the engine and the forms can act on. */
export class SupabaseError extends SyncTransportError {
  readonly reason: FailureReason

  constructor(
    reason: FailureReason,
    kind: SyncErrorKind,
    message: string,
    detail: { status?: number | null; code?: string | null; retryAfterMs?: number | null } = {},
  ) {
    super(kind, message, detail)
    this.name = 'SupabaseError'
    this.reason = reason
  }
}

const MESSAGES: Readonly<Record<FailureReason, string>> = {
  offline: "Can't reach Supabase. Check your internet connection and the project address.",
  unavailable: "Supabase isn't answering right now. Forge will try again.",
  unauthorized: 'Your sign-in has expired. Sign in again to keep syncing.',
  badKey:
    "Supabase didn't accept this key. Copy the anon (public) key from Project Settings → API.",
  rateLimited: 'Supabase is asking Forge to slow down. It will try again shortly.',
  setup: "The forge_rows table isn't in your project yet. Run the setup SQL.",
  forbidden: "The table's access rules are missing. Run the setup SQL again.",
  tooLarge: 'That change was too large to send in one piece.',
  rejected: 'Supabase refused the request.',
}
const TIMEOUT_MESSAGE = 'Supabase took too long to answer. Forge will try again.'
const PAUSED_MESSAGE =
  'Your Supabase project may be paused. Free projects pause after a week without use; restore it from the Supabase dashboard.'

/** GoTrue codes the sign-in forms meet, with a sentence each; anything else gets its reason's message. */
const CODE_MESSAGES: Readonly<Record<string, string>> = {
  otp_expired: 'That code or link has expired or was already used. Send a new one.',
  flow_state_expired: 'That link has expired. Send a new one.',
  flow_state_not_found: 'That link was not started here. Type the code from the email instead.',
  bad_code_verifier: 'That link was not started here. Type the code from the email instead.',
  signup_disabled: "This project isn't accepting new accounts, and that email has none yet.",
  email_address_invalid: "Supabase doesn't accept that email address.",
  email_provider_disabled: 'Email sign-in is switched off in this project.',
  over_email_send_rate_limit:
    'Supabase limits how many sign-in emails it sends. Wait a little, then try again.',
}

/** An answer that arrived but cannot be used (not JSON, not the shape the call promises). */
export function badAnswer(status: number | null = null): SupabaseError {
  return new SupabaseError(
    'rejected',
    'server',
    "Supabase answered with something Forge didn't expect.",
    { status },
  )
}

interface Failure {
  status: number | null
  code?: string | null
  message?: string
  timedOut?: boolean
  online?: boolean
  retryAfterMs?: number | null
}

function failure(req: HttpRequest, f: Failure): SupabaseError {
  const { status } = f
  const code = f.code ?? null
  let kind = classifySyncError({
    status,
    code,
    timedOut: f.timedOut,
    offline: status === null && f.online === false,
    refresh: req.op === 'refresh',
  })
  let reason: FailureReason
  if (
    status === 401 &&
    (/api ?key/i.test(f.message ?? '') || (!req.session && req.op !== 'refresh'))
  ) {
    reason = 'badKey'
    kind = 'signedOut'
  } else if ((status === 401 || status === 403) && req.url.includes('/auth/v1/')) {
    reason = 'unauthorized'
    kind = 'signedOut'
  } else if (kind === 'offline' || kind === 'rateLimited') {
    reason = kind
  } else if (kind === 'signedOut') {
    reason = 'unauthorized'
  } else if (kind === 'setup' || kind === 'forbidden' || kind === 'tooLarge') {
    reason = kind
  } else {
    reason = status === null || status >= 500 ? 'unavailable' : 'rejected'
  }
  const message =
    (code !== null && Object.hasOwn(CODE_MESSAGES, code) ? CODE_MESSAGES[code] : undefined) ??
    (reason !== 'unavailable'
      ? MESSAGES[reason]
      : f.timedOut === true
        ? TIMEOUT_MESSAGE
        : status !== null && status >= 520
          ? PAUSED_MESSAGE
          : MESSAGES.unavailable)
  return new SupabaseError(reason, kind, message, { status, code, retryAfterMs: f.retryAfterMs })
}

/** Sends one described request and returns its parsed JSON body (`null` when the answer has none). */
export type Send = (req: HttpRequest) => Promise<unknown>

/** The part of `fetch` this needs, so a fake is a plain function. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface HttpOptions {
  fetch: FetchLike
  /** Give up on a call (headers and body) after this long. Default 20 s. */
  timeoutMs?: number
  /** `navigator.onLine`; injected so nothing here reads the DOM. Default: online. */
  isOnline?: () => boolean
  /**
   * Only for reading a `Retry-After` date. Default `Date.now`. (A browser exposes `Retry-After` on a
   * cross-origin answer only when the server lists it in `Access-Control-Expose-Headers`; when it does
   * not, `retryAfterMs` is null and the engine's one-minute floor for a 429 applies.)
   */
  now?: () => Millis
}

export function createHttp(opts: HttpOptions): Send {
  const { fetch: doFetch, timeoutMs = 20_000, isOnline = () => true, now = Date.now } = opts
  return async (req) => {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    let res: Response
    let text: string
    try {
      res = await doFetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body ?? undefined,
        keepalive: req.keepalive,
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
      text = await res.text()
    } catch {
      throw failure(req, { status: null, timedOut, online: isOnline() })
    } finally {
      clearTimeout(timer)
    }
    let body: unknown = null
    let readable = true
    if (text !== '') {
      try {
        body = JSON.parse(text)
      } catch {
        readable = false
      }
    }
    if (res.ok) {
      if (!readable) throw badAnswer(res.status)
      return body
    }
    throw failure(req, {
      status: res.status,
      ...errorDetail(body),
      retryAfterMs:
        res.status === 429 ? parseRetryAfter(res.headers.get('Retry-After'), now()) : null,
    })
  }
}
