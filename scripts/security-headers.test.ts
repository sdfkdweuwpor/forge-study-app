import { describe, expect, it } from 'vitest'
import { securityHeaders, toHeadersFile } from '../security-headers.mjs'

const csp = securityHeaders['Content-Security-Policy'] ?? ''

/** The policy as `{ directive: sources }`. */
function directives(policy: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name) out[name] = sources
  }
  return out
}

describe('the Content-Security-Policy and cloud sync (PLAN §4.7.2)', () => {
  it('lets the page connect to hosted Supabase projects, the favicon host and itself, and nothing else', () => {
    expect(directives(csp)['connect-src']).toEqual([
      "'self'",
      'https://icons.duckduckgo.com',
      'https://*.supabase.co',
    ])
  })

  it('names Supabase nowhere else, and adds no blanket source, websocket or http: source', () => {
    for (const [name, sources] of Object.entries(directives(csp))) {
      if (name !== 'connect-src') expect(sources.join(' '), name).not.toContain('supabase')
      for (const source of sources) {
        expect(source, `${name} ${source}`).not.toMatch(
          /^(\*|https?:|wss?:|wss?:\/\/.*|http:\/\/.*)$/,
        )
      }
    }
  })

  it('keeps scripts, frames and forms as locked down as before', () => {
    const policy = directives(csp)
    expect(policy['script-src']).toEqual(["'self'"])
    expect(policy['default-src']).toEqual(["'self'"])
    expect(policy['object-src']).toEqual(["'none'"])
    expect(policy['frame-ancestors']).toEqual(["'none'"])
    expect(policy['form-action']).toEqual(["'self'"])
  })

  it('reaches the built _headers file unchanged', () => {
    expect(toHeadersFile()).toContain(`Content-Security-Policy: ${csp}\n`)
    expect(toHeadersFile()).toContain('connect-src')
  })
})
