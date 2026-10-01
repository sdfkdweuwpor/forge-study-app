import { describe, expect, it } from 'vitest'
import {
  CONFIG_MESSAGES,
  KEY_KINDS,
  parseApiKey,
  parseProjectUrl,
  validateSyncConfig,
  type ConfigIssueCode,
} from './syncConfig'

const REF = 'abcdefghijklmnopqrst'
const OTHER_REF = 'zzzzzzzzzzzzzzzzzzzz'
const URL_OK = `https://${REF}.supabase.co`

const b64url = (text: string): string =>
  btoa(text).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

function jwt(payload: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.c2lnbmF0dXJl`
}

const anonJwt = (ref: string | null = REF) =>
  jwt({
    iss: 'supabase',
    ...(ref === null ? {} : { ref }),
    role: 'anon',
    iat: 1700000000,
    exp: 2000000000,
  })
const serviceJwt = (ref: string | null = REF) =>
  jwt({ iss: 'supabase', ...(ref === null ? {} : { ref }), role: 'service_role', iat: 1, exp: 2 })
const PUBLISHABLE = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
// Assembled at runtime: a literal secret-shaped key trips GitHub push protection, and this one is fake.
const SECRET = ['sb', 'secret', 'FAKEfakeFAKEfake-0000_0000fakeFAKE'].join('_')

function urlIssue(input: string): ConfigIssueCode | 'ok' {
  const r = parseProjectUrl(input)
  return r.ok ? 'ok' : r.issue.code
}
function keyIssue(input: string, ref: string | null = REF): ConfigIssueCode | 'ok' {
  const r = parseApiKey(input, ref)
  return r.ok ? 'ok' : r.issue.code
}

describe('parseProjectUrl', () => {
  it('accepts https://<ref>.supabase.co in every plausible spelling', () => {
    for (const input of [
      URL_OK,
      `${URL_OK}/`,
      `  ${URL_OK}  `,
      `${REF}.supabase.co`,
      `${URL_OK}/rest/v1/`,
      `${URL_OK}/auth/v1/settings?x=1#top`,
      `HTTPS://${REF.toUpperCase()}.SUPABASE.CO/`,
      `${REF}.supabase.co/dashboard`,
    ]) {
      const r = parseProjectUrl(input)
      expect(r, input).toEqual({ ok: true, value: { url: URL_OK, ref: REF } })
    }
  })

  it('accepts digits in the ref', () => {
    const ref = 'a1b2c3d4e5f6g7h8i9j0'
    expect(parseProjectUrl(`https://${ref}.supabase.co`)).toEqual({
      ok: true,
      value: { url: `https://${ref}.supabase.co`, ref },
    })
  })

  it('refuses an empty or blank address', () => {
    expect(urlIssue('')).toBe('urlEmpty')
    expect(urlIssue('   \n')).toBe('urlEmpty')
  })

  it('refuses http, and says it is the scheme', () => {
    expect(urlIssue(`http://${REF}.supabase.co`)).toBe('urlNotHttps')
    expect(urlIssue(`ftp://${REF}.supabase.co`)).toBe('urlNotHttps')
  })

  it('refuses custom domains, self-hosted Supabase and localhost, with the static-policy reason', () => {
    for (const input of [
      'https://api.example.com',
      'https://supabase.example.com',
      'https://db.forge.myschool.edu',
      'http://localhost:54321',
      'localhost:54321',
      'https://127.0.0.1:8000',
      'https://192.168.1.20',
      'https://[::1]',
      'https://supabase.com/dashboard/project/abcdefghijklmnopqrst',
      `https://${REF}.supabase.co.evil.example`,
      `https://${REF}.supabase.com`,
      `https://${REF}.supabase.in`,
      `https://${REF}-supabase.co`,
      REF,
    ]) {
      expect(urlIssue(input), input).toBe('urlNotSupabase')
    }
    const r = parseProjectUrl('https://api.example.com')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issue.field).toBe('url')
      expect(r.issue.message).toContain('Forge can only reach addresses ending in .supabase.co.')
      expect(r.issue.message).toContain('fixed when it is built')
    }
  })

  it('refuses refs that are not exactly 20 lowercase letters or digits', () => {
    expect(urlIssue(`https://${REF.slice(1)}.supabase.co`)).toBe('urlBadRef') // 19
    expect(urlIssue(`https://${REF}x.supabase.co`)).toBe('urlBadRef') // 21
    expect(urlIssue('https://abc-defghijklmnopqrs.supabase.co')).toBe('urlBadRef')
    expect(urlIssue('https://abc_defghijklmnopqrs.supabase.co')).toBe('urlBadRef')
    expect(urlIssue('https://.supabase.co')).toBe('urlBadRef')
    expect(urlIssue(`https://db.${REF}.supabase.co`)).toBe('urlBadRef')
    expect(urlIssue(`https://${REF}.storage.supabase.co`)).toBe('urlBadRef')
  })

  it('refuses addresses that carry a login or a port, and text that is not an address', () => {
    expect(urlIssue(`https://user:pw@${REF}.supabase.co`)).toBe('urlMalformed')
    expect(urlIssue(`https://${REF}.supabase.co:8443`)).toBe('urlMalformed')
    expect(urlIssue('https://my project.supabase.co')).toBe('urlMalformed')
    expect(urlIssue('javascript:alert(1)')).toBe('urlMalformed')
    expect(urlIssue('https://')).toBe('urlMalformed')
  })

  it('accepts the default https port spelled out', () => {
    expect(urlIssue(`https://${REF}.supabase.co:443`)).toBe('ok')
  })
})

describe('parseApiKey', () => {
  it('accepts a legacy anon JWT for this project, and reads the ref out of it', () => {
    const key = anonJwt()
    expect(parseApiKey(key, REF)).toEqual({
      ok: true,
      value: { anonKey: key, kind: 'anonJwt', ref: REF },
    })
  })

  it('accepts an anon JWT without a ref claim, and one when the URL is not known yet', () => {
    const noRef = anonJwt(null)
    expect(parseApiKey(noRef, REF)).toEqual({
      ok: true,
      value: { anonKey: noRef, kind: 'anonJwt', ref: null },
    })
    expect(keyIssue(anonJwt(OTHER_REF), null)).toBe('ok')
  })

  it('accepts an sb_publishable_ key', () => {
    expect(parseApiKey(PUBLISHABLE, REF)).toEqual({
      ok: true,
      value: { anonKey: PUBLISHABLE, kind: 'publishable', ref: null },
    })
  })

  it('refuses a JWT that names another project', () => {
    const r = parseApiKey(anonJwt(OTHER_REF), REF)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issue.code).toBe('keyWrongProject')
      expect(r.issue.message).toBe('This key belongs to another project.')
    }
  })

  it('refuses a service_role JWT, whichever project it names, with the secret-key message', () => {
    for (const ref of [REF, OTHER_REF, null]) {
      const r = parseApiKey(serviceJwt(ref), REF)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.issue.code).toBe('keyServiceRole')
        expect(r.issue.message).toBe(
          'This is a secret key. It must never be put in an app. Use the anon (public) key from Project Settings → API.',
        )
      }
    }
  })

  it('refuses any sb_secret_ key, even a short or odd one', () => {
    expect(keyIssue(SECRET)).toBe('keySecret')
    expect(keyIssue('sb_secret_')).toBe('keySecret')
    expect(keyIssue('sb_secret_x')).toBe('keySecret')
    expect(CONFIG_MESSAGES.keySecret).toBe(CONFIG_MESSAGES.keyServiceRole)
  })

  it('refuses a JWT that is not the anon role', () => {
    expect(keyIssue(jwt({ ref: REF, role: 'authenticated' }))).toBe('keyNotAnon')
    expect(keyIssue(jwt({ ref: REF }))).toBe('keyNotAnon')
  })

  it('refuses garbage, and an sb_publishable_ key that is cut short', () => {
    for (const input of [
      'hello',
      'eyJhbGciOiJIUzI1NiJ9',
      'a.b.c',
      'sb_publishable_',
      'sb_publishable_short',
      'sb_publishable_has spaces?!',
      'https://example.com',
      'a.b',
      `${anonJwt()}.extra`,
    ]) {
      expect(keyIssue(input), input).toBe('keyMalformed')
    }
    // Valid shape, payload is not JSON / not an object.
    expect(keyIssue(`${b64url('{}')}.${b64url('not json')}.c2ln`)).toBe('keyMalformed')
    expect(keyIssue(`${b64url('{}')}.${b64url('[1,2]')}.c2ln`)).toBe('keyMalformed')
    expect(keyIssue(`${b64url('{}')}.@@@.c2ln`)).toBe('keyMalformed')
  })

  it('refuses an empty key', () => {
    expect(keyIssue('')).toBe('keyEmpty')
    expect(keyIssue('  \n\t ')).toBe('keyEmpty')
  })

  it('takes whitespace out: padding, a trailing newline, a wrapped paste', () => {
    const key = anonJwt()
    const wrapped = `${key.slice(0, 40)}\n${key.slice(40, 90)} \r\n  ${key.slice(90)}`
    for (const input of [`  ${key}\n`, wrapped, `\t${PUBLISHABLE} `]) {
      const r = parseApiKey(input, REF)
      expect(r.ok, input).toBe(true)
    }
    const r = parseApiKey(wrapped, REF)
    expect(r.ok && r.value.anonKey).toBe(key)
  })

  it('reduces a pasted header or quoted string to the key', () => {
    const key = anonJwt()
    for (const input of [
      `Bearer ${key}`,
      `bearer\t${key}`,
      `Authorization: Bearer ${key}`,
      `authorization:Bearer ${key}`,
      `apikey: ${key}`,
      `"${key}"`,
      `'${key}',`,
      `"apikey: ${key}"`,
      `"Authorization: Bearer ${key}";`,
    ]) {
      const r = parseApiKey(input, REF)
      expect(r.ok && r.value.anonKey, input).toBe(key)
    }
    expect(parseApiKey(`apikey: ${PUBLISHABLE}`, REF)).toMatchObject({
      ok: true,
      value: { anonKey: PUBLISHABLE, kind: 'publishable' },
    })
    // A label does not hide a secret key.
    expect(keyIssue(`Bearer ${SECRET}`)).toBe('keySecret')
    expect(keyIssue(`Authorization: Bearer ${serviceJwt()}`)).toBe('keyServiceRole')
    expect(keyIssue('Bearer')).toBe('keyMalformed')
    expect(keyIssue('apikey:')).toBe('keyEmpty')
  })

  it('refuses a JWT whose header is not a JSON object with an alg', () => {
    const payload = b64url(JSON.stringify({ iss: 'supabase', ref: REF, role: 'anon' }))
    for (const head of ['{}', '{"typ":"JWT"}', '{"alg":5}', '[1]', 'not json', '"alg"']) {
      expect(keyIssue(`${b64url(head)}.${payload}.c2ln`), head).toBe('keyMalformed')
    }
    // A label fused onto the front (no space to strip) mangles the header.
    expect(keyIssue(`Bearer${anonJwt()}`)).toBe('keyMalformed')
    expect(keyIssue(`${b64url('{"alg":"HS256"}')}.${payload}.c2ln`)).toBe('ok')
  })

  it('never puts the key in a message', () => {
    for (const input of [serviceJwt(), SECRET, anonJwt(OTHER_REF), 'garbage-key-value-123']) {
      const r = parseApiKey(input, REF)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.issue.message).not.toContain(input)
        expect(JSON.stringify(r.issue)).not.toContain(input.slice(0, 20))
      }
    }
  })
})

describe('validateSyncConfig', () => {
  it('builds a config from a good URL and an anon JWT', () => {
    const key = anonJwt()
    expect(validateSyncConfig(`${REF}.supabase.co/`, ` ${key} `)).toEqual({
      ok: true,
      config: { url: URL_OK, ref: REF, anonKey: key, keyKind: 'anonJwt' },
    })
  })

  it('builds a config from a publishable key', () => {
    expect(validateSyncConfig(URL_OK, PUBLISHABLE)).toEqual({
      ok: true,
      config: { url: URL_OK, ref: REF, anonKey: PUBLISHABLE, keyKind: 'publishable' },
    })
  })

  it('reports both fields when both are wrong, url first', () => {
    const r = validateSyncConfig('https://api.example.com', SECRET)
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.issues.map((i) => [i.field, i.code])).toEqual([
        ['url', 'urlNotSupabase'],
        ['key', 'keySecret'],
      ])
  })

  it('checks the key against the URL only when the URL is good', () => {
    const wrong = validateSyncConfig(URL_OK, anonJwt(OTHER_REF))
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.issues.map((i) => i.code)).toEqual(['keyWrongProject'])
    const badUrl = validateSyncConfig('nope.example.com', anonJwt(OTHER_REF))
    expect(badUrl.ok).toBe(false)
    if (!badUrl.ok) expect(badUrl.issues.map((i) => i.code)).toEqual(['urlNotSupabase'])
  })

  it('refuses a secret key even when the URL is bad', () => {
    const r = validateSyncConfig('', serviceJwt())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.map((i) => i.code)).toEqual(['urlEmpty', 'keyServiceRole'])
  })
})

describe('the vocabulary', () => {
  it('has a message for every issue code, one calm sentence or two', () => {
    for (const message of Object.values(CONFIG_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10)
      expect(message).not.toMatch(/!|\bERROR\b|\binvalid\b/i)
    }
    expect(KEY_KINDS).toEqual(['anonJwt', 'publishable'])
  })
})
