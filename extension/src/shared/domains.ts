/**
 * Domain and URL helpers. Pure and dependency-free: used by the rule builder, the service worker
 * and the blocked page.
 */

/** Dot-separated DNS labels, at least two of them (so no bare `localhost`, no `*`, no spaces). */
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Reduces what a person might type (`https://www.Instagram.com/explore?x=1`, `*.reddit.com`,
 * `twitch.tv:443`) to a lowercase ASCII hostname, or null when it is not a usable domain.
 * `www.` is kept: `www.reddit.com` is a subdomain entry like any other.
 */
export function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim().replace(/^\*\./, '')
  if (!trimmed) return null
  let host: string
  try {
    host = new URL(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`).hostname
  } catch {
    return null
  }
  host = host.replace(/\.$/, '')
  return HOSTNAME.test(host) ? host : null
}

/** True when `host` is `domain` or one of its subdomains (`m.youtube.com` is under `youtube.com`; `notyoutube.com` is not). */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase()
  const d = domain.toLowerCase()
  return h === d || h.endsWith(`.${d}`)
}

/**
 * Normalizes a blocklist: drops invalid entries and duplicates, and drops an entry that is already
 * covered by a parent in the list (`m.youtube.com` next to `youtube.com`). Order is kept.
 */
export function normalizeBlocklist(raw: readonly string[]): string[] {
  const seen = new Set<string>()
  const domains: string[] = []
  for (const entry of raw) {
    const domain = normalizeDomain(entry)
    if (domain && !seen.has(domain)) {
      seen.add(domain)
      domains.push(domain)
    }
  }
  return domains.filter((d) => !domains.some((other) => other !== d && hostMatchesDomain(d, other)))
}

/**
 * Turns an allowlist entry into the prefix the rule matches: `host/path?query` with a lowercase
 * host, no scheme and no fragment. Entries containing declarativeNetRequest wildcard characters
 * (`*`, `^`, `|`) or whitespace are rejected so an entry can only ever mean a plain prefix.
 */
export function normalizeAllowEntry(raw: string): string | null {
  const s = raw.trim()
  if (!s || /[\s*^|]/.test(s)) return null
  const withoutScheme = s.replace(HAS_SCHEME, '')
  const cut = withoutScheme.search(/[/?#]/)
  const hostPart = cut === -1 ? withoutScheme : withoutScheme.slice(0, cut)
  const rest = cut === -1 ? '' : (withoutScheme.slice(cut).split('#')[0] ?? '')
  const host = normalizeDomain(hostPart)
  return host ? `${host}${rest}` : null
}

/**
 * Where "unlock" sends the tab. `candidate` comes from the page URL, which anyone can craft, so it
 * is only used when it is http(s) and its host is `domain` or a subdomain of it. Anything else falls
 * back to the site's front page.
 */
export function resolveReturnUrl(candidate: string, domain: string): string {
  const fallback = `https://${domain}/`
  try {
    const url = new URL(candidate)
    const isWeb = url.protocol === 'http:' || url.protocol === 'https:'
    return isWeb && hostMatchesDomain(url.hostname, domain) ? url.href : fallback
  } catch {
    return fallback
  }
}
