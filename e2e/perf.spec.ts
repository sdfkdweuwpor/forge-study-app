import { cpus, loadavg } from 'node:os'
import type { CDPSession, Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * Performance budgets in the browser, at the size a year-long degree reaches: `?seed=wgu-year` is the
 * WGU sample plus 2,000 finished study sessions and about 300 open ones on the same goal.
 *
 * What is budgeted is main-thread CPU, from Chrome's own thread-time counters (CDP `Performance` with
 * `threadTicks`). This machine often runs several builds and browsers at once, which stretches
 * wall-clock time five to ten times but barely moves CPU time, so a CPU budget fails only when the app
 * does more work. Wall time is checked as well, with the budget scaled by how busy the machine is (up
 * to 4x), to catch a hang or a long wait that CPU time cannot see. Each figure is the best of a few runs.
 */

/** 1 on an idle machine, up to 4 when every core has several runnable processes queued. */
const busyFactor = (): number => Math.min(4, Math.max(1, (loadavg()[0] ?? 0) / Math.max(1, cpus().length)))

const openRow = (page: Page) =>
  page.locator('main input[type="checkbox"][aria-label^="Done: "]:not(:checked)').first()

async function cpuClock(page: Page): Promise<() => Promise<number>> {
  const client: CDPSession = await page.context().newCDPSession(page)
  await client.send('Performance.enable', { timeDomain: 'threadTicks' })
  return async () => {
    const { metrics } = await client.send('Performance.getMetrics')
    return (metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0) * 1000
  }
}

/** Resolves once the page has painted a frame and run a task after it: it responds to input. */
const settled = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))))

/** Clicks the first open task's checkbox; ms until its completion motion has been painted. */
function clickToPaint(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const box = document.querySelector<HTMLInputElement>(
          'main input[type="checkbox"][aria-label^="Done: "]:not(:checked)',
        )
        const row = box?.closest('[data-motion]')
        if (!box || !row) {
          reject(new Error('no open task on screen'))
          return
        }
        const t0 = performance.now()
        const seen = new MutationObserver(() => {
          if (!row.getAttribute('data-phase')) return
          seen.disconnect()
          requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - t0), 0))
        })
        seen.observe(row, { attributes: true })
        box.click()
      }),
  )
}

const best = (xs: readonly number[]): number => Math.min(...xs)
const median = (xs: readonly number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

test.describe('performance with a year of study on one goal', () => {
  test.describe.configure({ timeout: 240_000 })

  test.beforeEach(async ({ page }) => {
    await gotoApp(page, '/', 'wgu-year')
    await expect(openRow(page)).toBeVisible({ timeout: 60_000 })
    // The seeding load runs its own start-up (streak rows, badges); let it finish before measuring.
    await page.waitForTimeout(1500)
  })

  test('the app starts and is interactive in under 1.5 s', async ({ page }) => {
    const cpu = await cpuClock(page)
    const wall: number[] = []
    const work: number[] = []
    for (let run = 0; run < 3; run++) {
      const c0 = await cpu()
      const t0 = Date.now()
      await page.goto('/')
      await openRow(page).waitFor()
      await settled(page)
      wall.push(Date.now() - t0)
      work.push((await cpu()) - c0)
    }
    // Typically 300–450 ms of main-thread work on Today.
    expect(best(work)).toBeLessThan(1500)
    expect(best(wall)).toBeLessThan(1500 * busyFactor())
  })

  for (const [name, path] of [
    ['Today', '/'],
    ['All tasks', '/tasks/all'],
  ] as const) {
    test(`finishing a task on ${name} shows in under 100 ms`, async ({ page }) => {
      await page.goto(path)
      await openRow(page).waitFor()
      await page.waitForTimeout(1000)
      const cpu = await cpuClock(page)
      const shown: number[] = []
      const cycle: number[] = []
      for (let run = 0; run < 3; run++) {
        const c0 = await cpu()
        shown.push(await clickToPaint(page))
        // The write lands and offers Undo, the row is struck through and leaves (about 1.2 s in all).
        await expect(page.getByRole('button', { name: 'Undo' }).first()).toBeVisible()
        await page.waitForTimeout(1500)
        cycle.push((await cpu()) - c0)
      }
      // Typically 10–25 ms from the click to the painted check, and 50–150 ms of work for the whole
      // completion: only the clicked row redraws, however long the list (before: 0.9–1.5 s on All tasks).
      expect(best(shown)).toBeLessThan(100 * busyFactor())
      expect(median(cycle)).toBeLessThan(400)
    })
  }

  test('long lists draw their first rows and the rest as they scroll', async ({ page }) => {
    await page.goto('/tasks/completed')
    const rows = page.locator('main li input[type="checkbox"][aria-label^="Done: "]')
    const more = page.getByRole('button', { name: /^Show \d[\d,]* more$/ })
    await expect(more).toBeVisible()
    await expect(page.getByText(/^Showing 100 of 2,0\d\d$/)).toBeVisible()
    expect(await rows.count()).toBe(100)
    await more.click()
    await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(300)
    // Scrolling near the end draws more by itself.
    const before = await rows.count()
    await rows.last().scrollIntoViewIfNeeded()
    await expect.poll(() => rows.count()).toBeGreaterThan(before)
  })
})
