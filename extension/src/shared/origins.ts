import { APP_ORIGIN } from './config.js'

/** Hosts served over plain http that may talk to the extension, on any port (mirrors `externally_connectable`). */
const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1']

/**
 * Is `senderUrl` (the `sender.url` of an external message) the Forge app? The URL is parsed and its
 * origin compared, never prefix-matched as text: `http://localhost.evil.com/` and
 * `https://forge-study-app.netlify.app.evil.com/` must not pass.
 */
export function isAllowedOrigin(senderUrl: string | undefined): boolean {
  if (!senderUrl) return false
  let url: URL
  try {
    url = new URL(senderUrl)
  } catch {
    return false
  }
  if (url.origin === APP_ORIGIN) return true
  return url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname)
}
