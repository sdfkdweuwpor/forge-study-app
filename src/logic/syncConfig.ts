/**
 * Cloud sync configuration (pure; PLAN §4.7.2). The person types a Supabase project URL and its anon
 * (publishable) key into Settings → Sync; this file decides whether Forge can use them and says why not,
 * in one calm sentence, when it cannot.
 *
 * Rules:
 *  - the URL is `https://<ref>.supabase.co` with `ref` = 20 lowercase letters or digits. A missing scheme
 *    gets `https://`, the path, query and hash are dropped. Anything else is refused. Custom domains and
 *    self-hosted Supabase cannot work: the app's `connect-src` policy is a static response header written
 *    at build time (`https://*.supabase.co`), so a browser would block any other host;
 *  - the key is a legacy anon JWT (`role: 'anon'`, and, when it carries a `ref`, the URL's) or a new
 *    `sb_publishable_…` key. A `service_role` JWT and any `sb_secret_…` key are refused: they bypass row
 *    level security and must never sit in an app. The anon key is public by design, so keeping it on the
 *    device is not keeping a secret;
 *  - a message never contains the key the person typed;
 *  - a pasted `Bearer …` or `apikey: …` is reduced to the key, and a JWT must have a real header.
 *
 * `SyncConfig`, `KeyKind` and the result unions are what the request builders (12B4) and the setup form
 * (12B5) consume. Nothing here reads a clock, the network or the DOM.
 */

/** How an API key is shaped, which decides how it is sent (a JWT doubles as a bearer, a publishable key never). */
export type KeyKind = 'anonJwt' | 'publishable'

/** A validated project: what `syncState` stores as `url` and `anonKey`, plus what was learned on the way. */
export interface SyncConfig {
  /** Normalised, `https://<ref>.supabase.co`, no trailing slash. */
  url: string
  /** The 20-character project reference (the URL's first label). */
  ref: string
  /** The key with surrounding and inner whitespace removed. */
  anonKey: string
  keyKind: KeyKind
}

export type ConfigField = 'url' | 'key'

export type ConfigIssueCode =
  | 'urlEmpty'
  | 'urlMalformed'
  | 'urlNotHttps'
  | 'urlNotSupabase'
  | 'urlBadRef'
  | 'keyEmpty'
  | 'keyMalformed'
  | 'keyServiceRole'
  | 'keySecret'
  | 'keyNotAnon'
  | 'keyWrongProject'

/** One reason a field cannot be used. `message` is what the form shows under the field. */
export interface ConfigIssue {
  field: ConfigField
  code: ConfigIssueCode
  message: string
}

/** A single field's parse: the value, or the one reason it is refused. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; issue: ConfigIssue }

/** A parsed project URL. */
export interface ProjectUrl {
  url: string
  ref: string
}

/** A parsed API key. `ref` is the project a JWT names, or null (a publishable key names none). */
export interface ApiKey {
  anonKey: string
  kind: KeyKind
  ref: string | null
}

/** Both fields together: a config, or every issue found (at most one per field). */
export type ConfigResult =
  { ok: true; config: SyncConfig } | { ok: false; issues: readonly ConfigIssue[] }

/** Every key kind, for tests and exhaustive switches. */
export const KEY_KINDS: readonly KeyKind[] = ['anonJwt', 'publishable']

// ─── Messages ───────────────────────────────────────────────────────────────

export const CONFIG_MESSAGES: Readonly<Record<ConfigIssueCode, string>> = {
  urlEmpty: "Enter your project's address, like https://abcdefghijklmnopqrst.supabase.co.",
  urlMalformed:
    "That doesn't look like a project address. Use the Project URL from Project Settings → API.",
  urlNotHttps: 'Supabase addresses start with https://.',
  urlNotSupabase:
    "Forge can only reach addresses ending in .supabase.co. The app's security policy is fixed when it is built, so custom domains and self-hosted Supabase can't be used.",
  urlBadRef:
    'That address is not a project URL. It should be 20 letters and numbers followed by .supabase.co, like abcdefghijklmnopqrst.supabase.co.',
  keyEmpty: 'Paste the anon (public) key from Project Settings → API.',
  keyMalformed:
    "That doesn't look like a Supabase key. Copy the anon (public) key from Project Settings → API.",
  keyServiceRole:
    'This is a secret key. It must never be put in an app. Use the anon (public) key from Project Settings → API.',
  keySecret:
    'This is a secret key. It must never be put in an app. Use the anon (public) key from Project Settings → API.',
  keyNotAnon: "That key isn't the anon (public) key. Use the anon key from Project Settings → API.",
  keyWrongProject: 'This key belongs to another project.',
}

function fail<T>(field: ConfigField, code: ConfigIssueCode): ParseResult<T> {
  return { ok: false, issue: { field, code, message: CONFIG_MESSAGES[code] } }
}

// ─── The project URL ────────────────────────────────────────────────────────

const HOST_SUFFIX = '.supabase.co'
const REF_PATTERN = /^[a-z0-9]{20}$/
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * `https://<ref>.supabase.co` from what a person typed: trimmed, `https://` added when there is no scheme,
 * host lower-cased, path, query and hash dropped. Refuses http, other hosts (custom domains, self-hosted,
 * localhost, addresses), other subdomains of supabase.co, and refs that are not 20 lowercase letters or
 * digits.
 */
export function parseProjectUrl(input: string): ParseResult<ProjectUrl> {
  const raw = input.trim()
  if (raw === '') return fail('url', 'urlEmpty')
  if (/\s/.test(raw)) return fail('url', 'urlMalformed')
  let url: URL
  try {
    url = new URL(SCHEME_PATTERN.test(raw) ? raw : `https://${raw}`)
  } catch {
    return fail('url', 'urlMalformed')
  }
  if (url.username !== '' || url.password !== '') return fail('url', 'urlMalformed')
  const host = url.hostname
  if (!host.endsWith(HOST_SUFFIX)) return fail('url', 'urlNotSupabase')
  const ref = host.slice(0, host.length - HOST_SUFFIX.length)
  if (!REF_PATTERN.test(ref)) return fail('url', 'urlBadRef')
  if (url.protocol !== 'https:') return fail('url', 'urlNotHttps')
  if (url.port !== '') return fail('url', 'urlMalformed')
  return { ok: true, value: { url: `https://${ref}${HOST_SUFFIX}`, ref } }
}

// ─── The API key ────────────────────────────────────────────────────────────

const SECRET_PREFIX = 'sb_secret_'
const PUBLISHABLE_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{8,}$/
const PUBLISHABLE_PREFIX = 'sb_publishable_'
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/

/** UTF-8 text from a base64url segment, or null when it is not valid base64url. */
function decodeSegment(segment: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  try {
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

/** A decoded JSON object, or null when the text is not JSON or not an object. */
function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * The claims of a JWT (not verified: nothing here can), or null when it is not a JWT: three segments,
 * a header that is a JSON object with a string `alg` (RFC 7515 requires it, and a mangled paste such as
 * `Bearer` fused onto the front fails it), and a payload that is a JSON object.
 */
function jwtClaims(token: string): Record<string, unknown> | null {
  if (!JWT_PATTERN.test(token)) return null
  const [head, payload] = token.split('.')
  if (head === undefined || payload === undefined) return null
  const headText = decodeSegment(head)
  const payloadText = decodeSegment(payload)
  if (headText === null || payloadText === null) return null
  if (typeof jsonObject(headText)?.alg !== 'string') return null
  return jsonObject(payloadText)
}

const QUOTES = /^["'`]+|["'`,;]+$/g
/** `Authorization: Bearer …`, `apikey: …` or `Bearer …`, as pasted from a curl command or the docs. */
const HEADER_LABEL = /^(?:(?:authorization|apikey)\s*:\s*)?(?:bearer\s+)?/i

/**
 * What a person pasted, reduced to the key: quotes and a trailing comma or semicolon removed, a leading
 * header label (`Authorization: Bearer`, `apikey:`) removed, then every whitespace character (keys are
 * pasted from wrapped terminals and password managers).
 */
function cleanKeyInput(input: string): string {
  const unquoted = input.trim().replace(QUOTES, '').replace(HEADER_LABEL, '')
  return unquoted.replace(QUOTES, '').replace(/\s+/g, '')
}

/**
 * A key a person pasted. Accepts a legacy anon JWT (`role: 'anon'`) or an `sb_publishable_…` key.
 * Refuses a `service_role` JWT and any `sb_secret_…` key before anything else, then a JWT of another
 * project when `expectedRef` (the URL's) is known. Whitespace anywhere is removed first, and a pasted
 * `Bearer` or `apikey:` label with it.
 */
export function parseApiKey(input: string, expectedRef: string | null = null): ParseResult<ApiKey> {
  const key = cleanKeyInput(input)
  if (key === '') return fail('key', 'keyEmpty')
  if (key.startsWith(SECRET_PREFIX)) return fail('key', 'keySecret')
  if (key.startsWith(PUBLISHABLE_PREFIX)) {
    return PUBLISHABLE_PATTERN.test(key)
      ? { ok: true, value: { anonKey: key, kind: 'publishable', ref: null } }
      : fail('key', 'keyMalformed')
  }
  const claims = jwtClaims(key)
  if (claims === null) return fail('key', 'keyMalformed')
  if (claims.role === 'service_role') return fail('key', 'keyServiceRole')
  if (claims.role !== 'anon') return fail('key', 'keyNotAnon')
  const ref = typeof claims.ref === 'string' && claims.ref !== '' ? claims.ref : null
  if (ref !== null && expectedRef !== null && ref !== expectedRef) {
    return fail('key', 'keyWrongProject')
  }
  return { ok: true, value: { anonKey: key, kind: 'anonJwt', ref } }
}

// ─── Both together ──────────────────────────────────────────────────────────

/**
 * The whole form: a `SyncConfig`, or the reason for each field that is refused. The key is checked
 * against the URL's ref only when the URL is good. Both fields are always looked at, so the form can
 * show both problems at once.
 */
export function validateSyncConfig(urlInput: string, keyInput: string): ConfigResult {
  const url = parseProjectUrl(urlInput)
  const key = parseApiKey(keyInput, url.ok ? url.value.ref : null)
  if (url.ok && key.ok) {
    return {
      ok: true,
      config: {
        url: url.value.url,
        ref: url.value.ref,
        anonKey: key.value.anonKey,
        keyKind: key.value.kind,
      },
    }
  }
  const issues: ConfigIssue[] = []
  if (!url.ok) issues.push(url.issue)
  if (!key.ok) issues.push(key.issue)
  return { ok: false, issues }
}
