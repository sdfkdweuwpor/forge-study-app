/**
 * Base-path helpers. Pure: no DOM, no `import.meta` (see location.ts, which passes Vite's `BASE_URL`).
 *
 * Forge is served from `/` on Netlify and from `/forge-study-app/` on GitHub Pages, so the browser's
 * pathname carries a prefix that the app itself never sees. Inside the app a path is always base-less
 * (`/tasks/inbox`): routes, saved views, `navigate` and `isAppPath` all use that form. Only the URL
 * boundary converts: `stripBase` on the way in (`getUrl`, `currentPath`), `withBase` on the way out
 * (`pushUrl`, and `href` for real `<a href>` values, so "open in new tab" works).
 */

/** `'/forge-study-app/'` becomes `'/forge-study-app'`, and the root base `'/'` becomes `''`. */
function prefixOf(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base
}

/**
 * Adds the base to a base-less app path (with or without a query or hash):
 * `withBase('/tasks?x=1', '/forge-study-app/')` is `'/forge-study-app/tasks?x=1'`, and `'/'` becomes
 * `'/forge-study-app/'`. The root base returns the path unchanged. Anything that does not start with
 * `/` is not an app path and is returned as is.
 */
export function withBase(path: string, base: string): string {
  if (!path.startsWith('/')) return path
  return `${prefixOf(base)}${path}`
}

/**
 * Removes the base from a pathname (optionally followed by a query or hash), the inverse of `withBase`:
 * `stripBase('/forge-study-app/tasks', '/forge-study-app/')` is `'/tasks'`, and the bare base, with or
 * without its trailing slash, is `'/'`. The prefix must end at a segment boundary, so
 * `/forge-study-appendix` is left alone. A URL that is not under the base is returned unchanged (the
 * router then shows "not found" for it).
 */
export function stripBase(url: string, base: string): string {
  const prefix = prefixOf(base)
  if (prefix === '' || !url.startsWith(prefix)) return url
  const rest = url.slice(prefix.length)
  if (rest === '') return '/'
  const next = rest.charAt(0)
  if (next === '/') return rest
  if (next === '?' || next === '#') return `/${rest}`
  return url
}
