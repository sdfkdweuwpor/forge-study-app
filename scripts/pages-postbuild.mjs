/**
 * Post-build step for GitHub Pages. Run after `vite build --base /forge-study-app/`:
 *
 *   node scripts/pages-postbuild.mjs [outDir]      outDir defaults to `dist`
 *
 * 1. `404.html` becomes a copy of `index.html`. Pages answers an unknown path with `404.html`, so a deep
 *    link such as /forge-study-app/tasks loads the app, which reads the path and shows that page. This
 *    overwrites the static "file not found" page that only Netlify uses (see netlify.toml).
 * 2. A `<meta http-equiv="Content-Security-Policy">` goes into both HTML files. Pages cannot send response
 *    headers, so the `_headers` file the build writes for Netlify does nothing here. The policy is the one in
 *    security-headers.mjs, so the two hosts cannot drift apart.
 * 3. An empty `.nojekyll`, so the site is served as it is, never run through Jekyll (which would skip files
 *    that start with an underscore).
 *
 * What a meta CSP cannot do: the other security headers (nosniff, Referrer-Policy, Permissions-Policy,
 * X-Frame-Options) are not sent at all, and the directives below are ignored in a <meta> element by the CSP
 * spec, so they are dropped rather than left to look like protection: `frame-ancestors` (Pages pages can be
 * framed), `report-uri` and `sandbox`. A meta policy also only governs what is parsed after it, so it is
 * placed first in <head>, right after the charset declaration.
 */
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { securityHeaders } from '../security-headers.mjs'

/** Directives that browsers ignore in a <meta> policy. */
export const META_IGNORED_DIRECTIVES = ['frame-ancestors', 'report-uri', 'sandbox']

const CSP_META = /<meta\s+http-equiv=(["'])Content-Security-Policy\1[^>]*>\s*/gi
const CHARSET_META = /<meta\s+charset=[^>]*>/i
const HEAD_OPEN = /<head(\s[^>]*)?>/i

/**
 * The header's policy without the directives a <meta> element ignores.
 * @param {string} policy  a full `Content-Security-Policy` header value
 * @returns {string}
 */
export function metaPolicy(policy) {
  return policy
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive !== '')
    .filter((directive) => {
      const name = directive.split(/\s+/, 1)[0]?.toLowerCase() ?? ''
      return !META_IGNORED_DIRECTIVES.includes(name)
    })
    .join('; ')
}

/** @param {string} text */
const escapeAttribute = (text) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * Puts the policy into the page as a <meta>, replacing one that is already there, so running the script
 * twice gives the same file.
 * @param {string} html
 * @param {string} policy  a full header value; the ignored directives are dropped here
 * @returns {string}
 */
export function withMetaCsp(html, policy) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(metaPolicy(policy))}" />`
  const without = html.replace(CSP_META, '')
  const anchor = CHARSET_META.exec(without) ?? HEAD_OPEN.exec(without)
  if (!anchor) throw new Error('No <head> to put the Content-Security-Policy meta tag in')
  const at = anchor.index + anchor[0].length
  return `${without.slice(0, at)}\n    ${meta}${without.slice(at)}`
}

/**
 * @param {string} outDir  the build output, e.g. `dist`
 * @returns {Promise<string[]>}  what was written, relative to `outDir`
 */
export async function postbuild(outDir) {
  const policy = securityHeaders['Content-Security-Policy']
  if (!policy) throw new Error('security-headers.mjs has no Content-Security-Policy')
  const index = resolve(outDir, 'index.html')
  const notFound = resolve(outDir, '404.html')

  await copyFile(index, notFound)
  for (const file of [index, notFound]) {
    await writeFile(file, withMetaCsp(await readFile(file, 'utf8'), policy))
  }
  await writeFile(resolve(outDir, '.nojekyll'), '')
  return ['index.html', '404.html', '.nojekyll']
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), '..', '..')
  const outDir = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'dist')
  try {
    const written = await postbuild(outDir)
    process.stdout.write(`pages-postbuild: wrote ${written.join(', ')} in ${outDir}\n`)
  } catch (error) {
    process.stderr.write(`pages-postbuild: ${error instanceof Error ? error.message : error}\n`)
    process.exit(1)
  }
}
