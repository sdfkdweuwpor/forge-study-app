import { test as base, expect, type Page } from '@playwright/test'

/** The "current time" for every e2e test and screenshot: 2026-09-29 09:30 America/New_York (EDT, UTC-4). */
export const FIXED_NOW = new Date('2026-09-29T09:30:00-04:00')
export const TIME_ZONE = 'America/New_York'

type Seed = 'wgu' | 'empty'

interface Fixtures {
  /** Freeze `Date.now()`/`new Date()` at FIXED_NOW (timers still run). Set `false` to opt out. */
  fixedClock: boolean
  /** console.error messages a test provokes on purpose (e.g. a blocked request). Everything else still fails it. */
  ignoreConsoleErrors: RegExp[]
}

/** Every test fails on any `console.error` or uncaught page error. */
export const test = base.extend<Fixtures>({
  fixedClock: [true, { option: true }],
  ignoreConsoleErrors: [[], { option: true }],
  page: async ({ page, fixedClock, ignoreConsoleErrors }, use) => {
    const problems: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !ignoreConsoleErrors.some((re) => re.test(msg.text()))) {
        problems.push(`console.error: ${msg.text()}`)
      }
    })
    page.on('pageerror', (err) => {
      problems.push(`pageerror: ${err.message}`)
    })
    if (fixedClock) await page.clock.setFixedTime(FIXED_NOW)
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
}
