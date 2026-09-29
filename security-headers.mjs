// Single source of truth for response security headers.
// Consumed by vite.config.ts: written to dist/_headers (Netlify) and used as `preview.headers`.
// Not applied to `vite dev` (HMR needs inline scripts and websockets).

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  // Inline styles: libraries (dnd-kit, floating UI) set style attributes at runtime.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://icons.duckduckgo.com",
  "font-src 'self'",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
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
