/**
 * PKCE for the magic-link sign-in (RFC 7636; PLAN §4.7.1). The verifier stays on this device; only its
 * S256 challenge goes to the server. A link opened in another browser then cannot be exchanged, which is
 * the point.
 */

/** base64url without padding: the alphabet is a subset of RFC 7636's unreserved characters. */
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * A new code verifier: 64 characters (RFC 7636 allows 43–128) from `A–Z a–z 0–9 - _`, the base64url of
 * 48 bytes (384 bits) from `crypto.getRandomValues`.
 */
export function createCodeVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(48)))
}

/**
 * The S256 challenge of a verifier: `base64url(SHA-256(verifier))`, 43 characters, no padding.
 * `crypto.subtle` exists only on secure pages (https, localhost), so anything else fails with a plain message.
 */
export async function codeChallengeS256(verifier: string): Promise<string> {
  if (typeof crypto.subtle === 'undefined')
    throw new Error('Signing in needs a secure (https) page.')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}
