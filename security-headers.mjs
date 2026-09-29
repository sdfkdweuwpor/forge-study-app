// Single source of truth for response security headers.
// Consumed by vite.config.ts: written to dist/_headers (Netlify) and used as `preview.headers`.
// Not applied to `vite dev` (HMR needs inline scripts and websockets).

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  // 'unsafe-inline' is a deliberate, low-risk concession: some libraries (dnd-kit's accessibility
  // helpers, popovers) inject <style> elements or style attributes. React `style` props alone would not
  // need it (they go through the CSSOM). It cannot run script: script-src stays 'self'.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://icons.duckduckgo.com",
  // data: because Vite inlines fonts under 4 KB (small unicode-range subsets) as data URIs.
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  // Workers are built as separate files (new Worker(new URL(...))); nothing uses blob: workers.
  "worker-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/** @type {Record<string, string>} */
export const securityHeaders = {
  'Content-Security-Policy': csp,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
}

/** Netlify `_headers` file contents applying the headers to every path. */
export function toHeadersFile(headers = securityHeaders) {
  const lines = Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`)
  return `/*\n${lines.join('\n')}\n`
}
