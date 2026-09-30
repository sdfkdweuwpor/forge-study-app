/* global caches -- used only inside page.evaluate, which runs in the browser */
// Lighthouse 12 (Performance + Accessibility) per route, each run in a fresh Chrome profile seeded with
// ?seed=wgu and with the service worker and caches cleared first (DECISIONS: Lighthouse via npx, no dependency).
// Serve a seed-enabled build first, e.g.:
//   VITE_ENABLE_SEED=1 npx vite build --outDir dist-lh && npx vite preview --outDir dist-lh --port 4600
// Usage: node scripts/perf/lighthouse.mjs <baseUrl> <mobile|desktop> <routes,comma,list> [runs]
//   e.g. node scripts/perf/lighthouse.mjs http://localhost:4600 mobile /,/tasks,/goals,/progress,/settings 3
// Chrome: CHROME_PATH, else Playwright's bundled Chromium. Results: test-results/lighthouse/*.json.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const [base, preset = 'mobile', routesArg = '/', runsArg = '1'] = process.argv.slice(2)
if (!base) {
  process.stderr.write('usage: node scripts/perf/lighthouse.mjs <baseUrl> <mobile|desktop> <routes> [runs]\n')
  process.exit(2)
}
const CHROME = process.env.CHROME_PATH ?? chromium.executablePath()
const OUT = join('test-results', 'lighthouse')
const routes = routesArg.split(',')
const runs = Number(runsArg)
const PORT = 9333 + (process.pid % 200)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

async function withChrome(fn) {
  const profile = join(tmpdir(), `forge-lh-${PORT}`)
  rmSync(profile, { recursive: true, force: true })
  const chrome = spawn(
    CHROME,
    ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--ignore-certificate-errors', 'about:blank'],
    { stdio: 'ignore' },
  )
  try {
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break
      } catch {
        // not up yet
      }
      await sleep(200)
    }
    return await fn()
  } finally {
    chrome.kill('SIGKILL')
    await sleep(300)
    rmSync(profile, { recursive: true, force: true })
  }
}

async function seed() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  const page = await browser.contexts()[0].newPage()
  await page.goto(`${base}/?seed=wgu`, { waitUntil: 'load' })
  await page.locator('main').first().waitFor({ timeout: 30_000 })
  await page.waitForTimeout(2500) // let the seed and the first live queries settle before measuring
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
    for (const k of await caches.keys()) await caches.delete(k)
  })
  await page.close()
  await browser.close().catch(() => {})
}

const results = []
for (const route of routes) {
  for (let run = 0; run < runs; run++) {
    const result = await withChrome(async () => {
      await seed()
      const file = join(OUT, `${preset}-${route === '/' ? 'today' : route.slice(1).replaceAll('/', '_')}-${run}.json`)
      const args = ['--yes', 'lighthouse@12', `${base}${route}`, `--port=${PORT}`, '--disable-storage-reset', '--only-categories=performance,accessibility', '--output=json', `--output-path=${file}`, '--quiet']
      if (preset === 'desktop') args.push('--preset=desktop')
      const r = spawnSync('npx', args, { encoding: 'utf8', timeout: 240_000, env: { ...process.env, CHROME_PATH: CHROME } })
      if (r.status !== 0) return { route, run, error: (r.stderr || '').slice(-400) }
      const j = JSON.parse(readFileSync(file, 'utf8'))
      const a = j.audits
      return {
        route,
        run,
        preset,
        perf: Math.round(j.categories.performance.score * 100),
        a11y: Math.round(j.categories.accessibility.score * 100),
        fcp: Math.round(a['first-contentful-paint'].numericValue),
        lcp: Math.round(a['largest-contentful-paint'].numericValue),
        tbt: Math.round(a['total-blocking-time'].numericValue),
        cls: Number(a['cumulative-layout-shift'].numericValue.toFixed(3)),
        failingA11y: j.categories.accessibility.auditRefs
          .filter((ref) => ref.weight > 0 && a[ref.id].score !== null && a[ref.id].score < 1)
          .map((ref) => ref.id),
      }
    })
    results.push(result)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }
}
writeFileSync(join(OUT, `summary-${preset}.json`), JSON.stringify(results, null, 1))
