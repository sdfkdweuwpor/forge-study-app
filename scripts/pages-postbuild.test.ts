import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { securityHeaders } from '../security-headers.mjs'
import { META_IGNORED_DIRECTIVES, metaPolicy, postbuild, withMetaCsp } from './pages-postbuild.mjs'

const HEADER = securityHeaders['Content-Security-Policy'] ?? ''

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Forge</title>
    <script src="/forge-study-app/theme-init.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`

const directives = (policy: string): string[] => policy.split(';').map((d) => d.trim())
const nameOf = (directive: string): string => directive.split(/\s+/, 1)[0] ?? ''

describe('metaPolicy', () => {
  it('drops frame-ancestors, report-uri and sandbox, which a <meta> policy ignores', () => {
    const out = metaPolicy(
      "default-src 'self'; frame-ancestors 'none'; report-uri /csp; sandbox allow-scripts; img-src 'self' data:",
    )
    expect(out).toBe("default-src 'self'; img-src 'self' data:")
  })

  it('matches directive names case-insensitively and leaves lookalikes', () => {
    expect(metaPolicy("Frame-Ancestors 'none'; frame-src 'self'")).toBe("frame-src 'self'")
  })

  it('keeps every other directive of the real policy, in order', () => {
    const kept = directives(metaPolicy(HEADER))
    const expected = directives(HEADER).filter((d) => !META_IGNORED_DIRECTIVES.includes(nameOf(d)))
    expect(kept).toEqual(expected)
    expect(kept.map(nameOf)).toEqual(expect.arrayContaining(['default-src', 'script-src']))
    expect(kept.map(nameOf)).not.toContain('frame-ancestors')
  })
})

describe('withMetaCsp', () => {
  it('puts the meta tag right after the charset declaration, before any script', () => {
    const out = withMetaCsp(PAGE, HEADER)
    const meta = out.indexOf('http-equiv="Content-Security-Policy"')
    expect(out.indexOf('<meta charset="UTF-8" />')).toBeLessThan(meta)
    expect(meta).toBeLessThan(out.indexOf('<script'))
    expect(meta).toBeLessThan(out.indexOf('<meta name="viewport"'))
    expect(out).toContain(`content="${metaPolicy(HEADER)}"`)
    expect(out).not.toContain('frame-ancestors')
  })

  it('falls back to the top of <head> when there is no charset', () => {
    const out = withMetaCsp('<html><head><title>x</title></head></html>', HEADER)
    expect(out.indexOf('<head>')).toBeLessThan(out.indexOf('Content-Security-Policy'))
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<title>'))
  })

  it('is idempotent: a second run replaces the tag instead of adding one', () => {
    const once = withMetaCsp(PAGE, HEADER)
    expect(withMetaCsp(once, HEADER)).toBe(once)
    expect(once.match(/http-equiv/g)).toHaveLength(1)
  })

  it('escapes the policy into a double-quoted attribute', () => {
    const out = withMetaCsp(PAGE, `default-src "x" <y> &z`)
    expect(out).toContain('content="default-src &quot;x&quot; &lt;y> &amp;z"')
  })

  it('refuses a page with no <head>', () => {
    expect(() => withMetaCsp('<p>no head</p>', HEADER)).toThrow(/head/)
  })
})

describe('postbuild', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('makes 404.html the app shell, adds the meta policy to both pages and writes .nojekyll', async () => {
    dir = await mkdtemp(join(tmpdir(), 'forge-pages-'))
    await writeFile(join(dir, 'index.html'), PAGE)
    await writeFile(join(dir, '404.html'), '<!doctype html><title>Not found</title>')

    await postbuild(dir)

    const index = await readFile(join(dir, 'index.html'), 'utf8')
    const notFound = await readFile(join(dir, '404.html'), 'utf8')
    expect(notFound).toBe(index)
    expect(notFound).toContain('<div id="root">')
    expect(notFound).not.toContain('Not found')
    expect(index).toContain('http-equiv="Content-Security-Policy"')
    expect((await stat(join(dir, '.nojekyll'))).size).toBe(0)
  })
})
