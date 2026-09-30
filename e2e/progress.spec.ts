import type { Locator, Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'
import { withHistory } from './progressHistory'

/**
 * Phase 7B: the Progress page and its charts. The clock is frozen at Tue 2026-09-29 09:30 EDT (the
 * fixture's). History comes from `buildProgressSample`: a year of counted sessions and 12 weeks of
 * finished tasks, written straight into IndexedDB behind the seeded WGU data; a fresh load then builds
 * the day rows from them at app start.
 */

const chart = (page: Page, name: string): Locator => page.getByRole('img', { name })
const tooltip = (page: Page): Locator => page.getByTestId('chart-tooltip')

test.describe('Progress page', () => {
  test('renders the header, the heatmap and every chart from seed data', async ({ page }) => {
    await withHistory(page)

    // The four figures.
    for (const id of ['stat-streak', 'stat-focus', 'stat-tasks', 'stat-level']) {
      await expect(page.getByTestId(id)).toBeVisible()
    }
    await expect(page.getByTestId('stat-focus')).toContainText(/\d+(\.\d)? h/)
    await expect(page.getByTestId('stat-level')).toContainText('XP')

    // One heading per section, each a figure with a caption, an SVG image and a hidden data table.
    for (const title of [
      'Focus, past year',
      'Focus minutes',
      'Tasks finished',
      'Time per goal',
      'Best time of day',
      'Estimate accuracy',
    ]) {
      await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible()
      const figure = page
        .locator('figure')
        .filter({ has: page.getByRole('heading', { name: title }) })
      await expect(figure.locator('figcaption')).toBeVisible()
      await expect(figure.getByRole('img', { name: title })).toBeVisible()
      await expect(figure.locator('.sr-only table tbody tr').first()).toBeAttached()
    }
    await expect(page.getByRole('heading', { name: 'Recent badges', level: 2 })).toBeVisible()

    // The year: 53 weeks of cells, a legend, month names and Mon/Wed/Fri.
    const heat = page
      .locator('figure')
      .filter({ has: page.getByRole('heading', { name: 'Focus, past year' }) })
    expect(await heat.locator('rect[data-level]').count()).toBeGreaterThan(300)
    expect(await heat.locator('rect[data-level="4"]').count()).toBeGreaterThan(5)
    await expect(heat).toContainText('Less')
    await expect(heat).toContainText('More')
    await expect(heat).toContainText('Streak freeze')
    for (const label of ['Mon', 'Wed', 'Fri', 'Sep'])
      await expect(heat.getByRole('img', { name: 'Focus, past year' })).toContainText(label)

    // The sentence under the estimate chart.
    await expect(
      page.getByText(/\d+ of \d+ finished tasks took about as long as you planned/),
    ).toBeVisible()
  })

  test('the heatmap: arrow keys move the tooltip, Escape hides it', async ({ page }) => {
    await withHistory(page)
    const heat = chart(page, 'Focus, past year')
    await expect(tooltip(page)).toHaveCount(0)

    await heat.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(tooltip(page)).toBeVisible()
    const first = await tooltip(page).innerText()
    expect(first).toMatch(/\w{3}, \w{3} \d+/)

    await page.keyboard.press('ArrowLeft')
    await expect(tooltip(page)).not.toHaveText(first)
    const second = await tooltip(page).innerText()
    await page.keyboard.press('ArrowDown')
    await expect(tooltip(page)).not.toHaveText(second)

    // The same words are spoken through a polite live region.
    await expect(page.locator('figure [aria-live="polite"]').first()).toContainText(
      /\w{3}, \w{3} \d+:/,
    )

    await page.keyboard.press('Escape')
    await expect(tooltip(page)).toHaveCount(0)
    // Escape with nothing showing is left to the app (it closes overlays), so a second one does nothing here.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible()
  })

  test('the heatmap starts on today and never selects a day that has not happened', async ({
    page,
  }) => {
    await withHistory(page)
    await chart(page, 'Focus, past year').focus()
    await page.keyboard.press('ArrowRight')
    await expect(tooltip(page)).toContainText('Tue, Sep 29')
    // Wednesday is still in the future: Down stays put.
    await page.keyboard.press('ArrowDown')
    await expect(tooltip(page)).toContainText('Tue, Sep 29')
    await page.keyboard.press('ArrowLeft')
    await expect(tooltip(page)).toContainText('Tue, Sep 22')
    await page.keyboard.press('Home')
    // Home is the first day of the year shown: Monday 2025-09-29.
    await expect(tooltip(page)).toContainText('Mon, Sep 29')
  })

  test('the 30-day bars: arrows walk the days and the tooltip follows', async ({ page }) => {
    await withHistory(page)
    const bars = chart(page, 'Focus minutes')
    await bars.focus()
    // Keyboard focus lands on today at once.
    await expect(tooltip(page)).toContainText('Tue, Sep 29')
    await page.keyboard.press('ArrowLeft')
    await expect(tooltip(page)).toContainText('Mon, Sep 28')
    await page.keyboard.press('Home')
    // Home is the first of the 30 days.
    await expect(tooltip(page)).toContainText('Mon, Aug 31')
    await page.keyboard.press('End')
    await expect(tooltip(page)).toContainText('Tue, Sep 29')
  })

  test('hovering a bar shows its tooltip and leaving hides it', async ({ page }) => {
    await withHistory(page)
    const bars = chart(page, 'Focus minutes')
    await bars.scrollIntoViewIfNeeded()
    const box = await bars.boundingBox()
    if (!box) throw new Error('no chart')
    await page.mouse.move(box.x + box.width - 20, box.y + 60)
    await expect(tooltip(page)).toBeVisible()
    // Off to the side, over nothing that has a tooltip.
    await page.mouse.move(box.x - 60, box.y + 60)
    await expect(tooltip(page)).toHaveCount(0)
  })

  test('time per goal switches to courses, keeps the choice in the address, and `v g` switches back', async ({
    page,
  }) => {
    await withHistory(page)
    const time = page.locator('[data-section="time"]')
    await expect(time.getByRole('heading', { name: 'Time per goal' })).toBeVisible()
    await time.getByRole('radio', { name: 'Courses' }).click()
    await expect(time.getByRole('heading', { name: 'Time per course' })).toBeVisible()
    await expect(page).toHaveURL(/[?&]by=course/)
    await expect(time).toContainText('C779 Web Development Foundations')

    await page.reload()
    await expect(
      page.locator('[data-section="time"]').getByRole('heading', { name: 'Time per course' }),
    ).toBeVisible()

    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('v')
    await page.keyboard.press('g')
    await expect(
      page.locator('[data-section="time"]').getByRole('heading', { name: 'Time per goal' }),
    ).toBeVisible()
    await expect(page).not.toHaveURL(/by=/)
  })

  test('the palette can switch to time per course from anywhere', async ({ page }) => {
    await withHistory(page)
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('time per course')
    await page.keyboard.press('Enter')
    await expect(
      page.locator('[data-section="time"]').getByRole('heading', { name: 'Time per course' }),
    ).toBeVisible()
  })

  test('the hour histogram highlights its busiest hour and its bars are keyboard-reachable', async ({
    page,
  }) => {
    await withHistory(page)
    const hours = chart(page, 'Best time of day')
    await hours.focus()
    await page.keyboard.press('ArrowRight')
    // The first key lands on the busiest hour.
    await expect(tooltip(page)).toContainText(/\d{1,2}( AM| PM)?–\d{1,2} [AP]M|[AP]M–/)
    const table = page
      .locator('figure')
      .filter({ has: page.getByRole('heading', { name: 'Best time of day' }) })
      .locator('.sr-only table tbody tr')
    await expect(table).toHaveCount(24)
  })

  test('the estimate scatter is a single tab stop with a keyboard tooltip', async ({ page }) => {
    await withHistory(page)
    const scatter = chart(page, 'Estimate accuracy')
    await scatter.focus()
    await page.keyboard.press('ArrowRight')
    await expect(tooltip(page)).toContainText(/Planned [\d.]+, actual [\d.]+/)
    await expect(tooltip(page)).toContainText(/of the estimate|than planned/)
  })

  test('there is no horizontal scroll at 375px, and the heatmap shows the weeks that fit', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await withHistory(page)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    const heat = page
      .locator('figure')
      .filter({ has: page.getByRole('heading', { name: 'Focus, past year' }) })
    const cells = await heat.locator('rect[data-level]').count()
    expect(cells).toBeGreaterThan(100)
    expect(cells).toBeLessThan(200)
  })

  test('the sections stack in document order on a phone and run in two columns on a wide page', async ({
    page,
  }) => {
    // Left column, then right: the order Tab walks the page, so what the eye meets next is what Tab meets next.
    const order = [
      'Focus minutes',
      /^Time per (goal|course)$/,
      'Estimate accuracy',
      'Tasks finished',
      'Best time of day',
      'Recent badges',
    ]
    const boxes = async () => {
      const found = []
      for (const name of order) {
        const box = await page.getByRole('heading', { name, level: 2 }).boundingBox()
        if (!box) throw new Error(`no box for ${String(name)}`)
        found.push({ x: Math.round(box.x), y: Math.round(box.y) })
      }
      return found
    }

    await page.setViewportSize({ width: 375, height: 812 })
    await withHistory(page)
    const phone = await boxes()
    expect(new Set(phone.map((b) => b.x)).size, 'one column').toBe(1)
    const tops = phone.map((b) => b.y)
    expect(tops, 'each section is below the one before it in the document').toEqual(
      [...tops].sort((a, b) => a - b),
    )
    expect(new Set(tops).size).toBe(tops.length)

    await page.setViewportSize({ width: 1440, height: 900 })
    await expect.poll(async () => new Set((await boxes()).map((b) => b.x)).size).toBe(2)
    const wide = await boxes()
    const [left, right] = [wide.slice(0, 3), wide.slice(3)]
    expect(new Set(left.map((b) => b.x)).size, 'the first three share the left column').toBe(1)
    expect(new Set(right.map((b) => b.x)).size, 'the last three share the right column').toBe(1)
    expect(right[0]?.x).toBeGreaterThan(left[0]?.x ?? Infinity)
    for (const column of [left, right]) {
      const ys = column.map((b) => b.y)
      expect(ys).toEqual([...ys].sort((a, b) => a - b))
    }
  })

  test('a brand-new user sees one calm empty state, not six empty charts', async ({ page }) => {
    await gotoApp(page, '/progress', 'empty')
    await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your progress will grow here' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start focus' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add a task' })).toBeVisible()
    await expect(page.locator('figure')).toHaveCount(0)
    await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)

    await page.getByRole('button', { name: 'Start focus' }).click()
    await expect(page).toHaveURL(/\/focus/)
  })

  test('with tasks but no focus yet, the focus charts say what to do', async ({ page }) => {
    // The WGU seed has finished tasks and no sessions.
    await gotoApp(page, '/progress', 'wgu')
    await expect(page.getByTestId('stat-tasks')).toBeVisible()
    await expect(page.getByText('Each day you focus colors a square.')).toBeVisible()
    await expect(page.getByText('No focus time in the last 30 days.')).toBeVisible()
    await expect(page.getByText(/After a few sessions/)).toBeVisible()
  })
})
