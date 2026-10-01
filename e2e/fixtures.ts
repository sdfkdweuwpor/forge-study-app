import { test as base, expect, type Page } from '@playwright/test'

/** The "current time" for every e2e test and screenshot: 2026-09-29 09:30 America/New_York (EDT, UTC-4). */
export const FIXED_NOW = new Date('2026-09-29T09:30:00-04:00')
export const TIME_ZONE = 'America/New_York'

type Seed = 'wgu' | 'wgu-year' | 'empty'

/** A 1x1 transparent PNG: what every favicon lookup gets. */
const FAVICON_STUB = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

interface Fixtures {
  /** Freeze `Date.now()`/`new Date()` at FIXED_NOW (timers still run). Set `false` to opt out. */
  fixedClock: boolean
  /** Substrings of console.error messages a test provokes on purpose (e.g. a blocked request). Everything else still fails it. */
  ignoreConsoleErrors: string[]
  /**
   * Keep the first-launch gate out of the way (default). On a fresh database with no `?seed=` the app would
   * otherwise send every spec to `/welcome`. Set `false` to test onboarding itself (e2e/onboarding.spec.ts).
   */
  skipOnboarding: boolean
}

/** Every test fails on any `console.error` or uncaught page error. */
export const test = base.extend<Fixtures>({
  fixedClock: [true, { option: true }],
  ignoreConsoleErrors: [[], { option: true }],
  skipOnboarding: [true, { option: true }],
  page: async ({ page, fixedClock, ignoreConsoleErrors, skipOnboarding }, use) => {
    const problems: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !ignoreConsoleErrors.some((part) => msg.text().includes(part))
      ) {
        problems.push(`console.error: ${msg.text()}`)
      }
    })
    page.on('pageerror', (err) => {
      problems.push(`pageerror: ${err.message}`)
    })
    if (fixedClock) await page.clock.setFixedTime(FIXED_NOW)
    // `PREF_KEYS.skipOnboarding`: read only by builds compiled with VITE_ENABLE_SEED (these e2e builds).
    if (skipOnboarding) {
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem('forge:onboarding:skip', '1')
        } catch {
          // A frame with an opaque origin (about:blank, data:) has no storage; the app is not there anyway.
        }
      })
    }
    // The Blocker page asks DuckDuckGo for site icons. e2e never touches the network (offline, the
    // browser would log every refused request as a console error), so answer with a 1 px image.
    await page.route('https://icons.duckduckgo.com/**', (route) =>
      route.fulfill({ contentType: 'image/png', body: FAVICON_STUB }),
    )
    await use(page)
    expect(problems, 'the page logged errors').toEqual([])
  },
})

export { expect }

/** Opens an app path, optionally seeding sample data (`?seed=wgu|empty`), and waits for first render. */
export async function gotoApp(page: Page, path = '/', seed?: Seed): Promise<void> {
  const url = new URL(path, 'http://localhost')
  if (seed) url.searchParams.set('seed', seed)
  await page.goto(`${url.pathname}${url.search}${url.hash}`)
  await page.locator('#root > *').first().waitFor()
  // A page that settles (`Settle`) keeps its content hidden, unclickable and unfocusable for up to a
  // second: act once it shows, as a person would.
  await expect(page.locator('[data-settling]')).toHaveCount(0)
}
