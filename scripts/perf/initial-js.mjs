// The initial-JS budget (PLAN Phase 13: ≤ 180 KB gzip): the entry script plus every chunk index.html
// modulepreloads, gzipped at level 9. Usage: node scripts/perf/initial-js.mjs [distDir]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = 180
const dir = process.argv[2] ?? 'dist'
const html = readFileSync(resolve(dir, 'index.html'), 'utf8')
// Works for any base: '/assets/x.js', '/forge-study-app/assets/x.js' and './assets/x.js' all map to dir/assets/x.js.
const local = (href) => resolve(dir, href.replace(/^.*?\/?assets\//, 'assets/'))
const out = (line) => process.stdout.write(`${line}\n`)

const scripts = new Set()
for (const m of html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)) scripts.add(m[1])
for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]*href="([^"]+)"/g)) scripts.add(m[1])

let gz = 0
let raw = 0
for (const href of scripts) {
  const bytes = readFileSync(local(href))
  const size = gzipSync(bytes, { level: 9 }).length
  gz += size
  raw += bytes.length
  out(`${href.padEnd(48)} ${String(bytes.length).padStart(9)} ${String(size).padStart(8)}`)
}
for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)) {
  const bytes = readFileSync(local(m[1]))
  out(`css ${m[1]} ${bytes.length} raw, ${gzipSync(bytes, { level: 9 }).length} gzip`)
}
const kb = gz / 1024
out(`Initial JS: ${raw} B raw, ${gz} B gzip = ${kb.toFixed(1)} KB (budget ${BUDGET_KB} KB) ${kb <= BUDGET_KB ? 'OK' : 'OVER'}`)
process.exitCode = kb <= BUDGET_KB ? 0 : 1
