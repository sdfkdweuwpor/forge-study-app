/**
 * Builds the declarativeNetRequest dynamic rules from the extension state. Pure: it only *types*
 * against `chrome.declarativeNetRequest` and never reads the `chrome` global at runtime (the enum
 * values are their string literals), so it runs under Vitest, where `chrome` does not exist.
 */
import { hasActiveUnlock, isBlockingNow, type ExtensionState } from '../shared/state.js'
import { normalizeAllowEntry, normalizeBlocklist } from '../shared/domains.js'

/** Redirects have priority 1; an allow rule at priority 2 always wins over them. */
export const REDIRECT_PRIORITY = 1
export const ALLOW_PRIORITY = 2

/**
 * `extensionUrl` is `chrome.runtime.getURL('')`, e.g. `chrome-extension://<id>/`. The original URL
 * rides in the fragment (`blocked.html?site=<domain>#<url>`): the page reads it from
 * `location.hash`, so `&` and `#` inside the original URL cannot truncate it.
 */
export function buildRules(
  state: ExtensionState,
  now: number,
  extensionUrl: string,
): chrome.declarativeNetRequest.Rule[] {
  if (!isBlockingNow(state, now)) return []

  const rules: chrome.declarativeNetRequest.Rule[] = []
  let nextId = 1

  for (const domain of normalizeBlocklist(state.config.blocklist)) {
    if (hasActiveUnlock(state, domain, now)) continue
    rules.push({
      id: nextId++,
      priority: REDIRECT_PRIORITY,
      action: {
        type: 'redirect',
        redirect: { regexSubstitution: `${extensionUrl}blocked.html?site=${domain}#\\0` },
      },
      condition: {
        // `requestDomains` matches the domain and every subdomain; the regex only captures the whole URL.
        requestDomains: [domain],
        regexFilter: '^https?://.*',
        resourceTypes: ['main_frame'],
      },
    })
  }

  const allowed = new Set<string>()
  for (const entry of state.config.allowlist) {
    const prefix = normalizeAllowEntry(entry)
    if (!prefix || allowed.has(prefix)) continue
    allowed.add(prefix)
    rules.push({
      id: nextId++,
      priority: ALLOW_PRIORITY,
      action: { type: 'allow' },
      condition: { urlFilter: `||${prefix}`, resourceTypes: ['main_frame'] },
    })
  }

  return rules
}
