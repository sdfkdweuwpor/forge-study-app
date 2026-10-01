import { APP_ORIGIN, APP_PATH, FALLBACK_ORIGIN } from './config.js'

/** Hosts served over plain http that may talk to the extension, on any port (mirrors `externally_connectable`). */
const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1']

/**
 * Is `senderUrl` (the `sender.url` of an external message) the Forge app? The URL is parsed and its
 * origin compared, never prefix-matched as text: `http://localhost.evil.com/` and
 * `https://forge-study-app.netlify.app.evil.com/` must not pass.
 *
 * On GitHub Pages every project of the account shares one origin (`https://<user>.github.io`), so the
 * origin alone would also admit that account's other sites. There the path must be the app's own
 * (`/forge-study-app/…`). The manifest's `externally_connectable` can only match the whole origin.
 */
export function isAllowedOrigin(senderUrl: string | undefined): boolean {
  if (!senderUrl) return false
  let url: URL
  try {
    url = new URL(senderUrl)
  } catch {
    return false
  }
  if (url.origin === FALLBACK_ORIGIN) return true
  if (url.origin === APP_ORIGIN) {
    return url.pathname === APP_PATH.slice(0, -1) || url.pathname.startsWith(APP_PATH)
  }
  return url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname)
}
