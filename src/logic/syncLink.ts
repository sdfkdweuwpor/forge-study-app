/**
 * The sign-in link coming back (PLAN §4.7.1, §4.7.7). The magic link opens `/settings/sync?code=…` (PKCE:
 * the code is exchanged for a session with the verifier this device kept), or `?error=…&error_code=…`
 * when the link was used up or expired. GoTrue puts a failure in the query or, for other flows, in the
 * fragment, so both are read. Pure: the address and the words go in and out as data.
 */

export type LinkReturn =
  { kind: 'code'; code: string } | { kind: 'error'; errorCode: string | null }

/** What GoTrue's auth code looks like (a UUID today); anything odder is not exchanged. */
const AUTH_CODE = /^[A-Za-z0-9._~-]{8,200}$/

/**
 * The link's answer in the address, or null when the address carries none. An error wins over a code:
 * a link that failed must say so, not try to sign in.
 */
export function parseLinkReturn(
  query: Readonly<Record<string, string | undefined>>,
  hash: string,
): LinkReturn | null {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''))
  const read = (key: string): string | null => query[key] ?? fragment.get(key)
  const error = read('error')
  const errorCode = read('error_code')
  if (error !== null || errorCode !== null) return { kind: 'error', errorCode: errorCode ?? error }
  const code = read('code')
  return code !== null && AUTH_CODE.test(code) ? { kind: 'code', code } : null
}

/** A link opened in a browser that never asked for one has no verifier to go with it. */
export const OTHER_BROWSER_TEXT =
  'This link was opened in a different browser than the one that asked for it. Type the code from the email instead, or send a new link from here.'

export const LINK_EXPIRED_TEXT = 'That link has expired or was already used. Send a new one.'

export const LINK_FAILED_TEXT =
  "That sign-in link didn't work. Send a new one, or type the code from the email."

/** What the two sign-in fields say when what was typed cannot be sent. */
export const NEEDS_EMAIL_TEXT = 'Enter the email address you sign in with.'
export const NEEDS_CODE_TEXT = 'Type the code from the email: 6 to 10 digits.'

/** When something fails on this device and the cause is ours to log, not the person's to read. */
export const GENERIC_TEXT = 'Something went wrong on this device. Nothing was changed. Try again.'

/** The sentence for a link that came back with an error. The server's own text is never shown. */
export function linkErrorMessage(errorCode: string | null): string {
  return errorCode === 'otp_expired' || errorCode === 'access_denied'
    ? LINK_EXPIRED_TEXT
    : LINK_FAILED_TEXT
}

/** A plain check of what was typed as an email address; the server has the last word. */
export function looksLikeEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim())
}

/** The code from the email: 6 to 10 digits, with the spaces some mail apps add removed; null when it is not one. */
export function cleanEmailCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '')
  return /^\d{6,10}$/.test(digits) ? digits : null
}
